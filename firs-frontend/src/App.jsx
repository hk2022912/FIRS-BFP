import './App.css'

import { useState, useEffect, useRef, useCallback } from "react";
import "./index.css";

/* ─── CONFIGG ──────────────────────────────────────────────────────────────── */
const API_BASE = "https://firs-bfp.onrender.com/api";

function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Token ${token}` };
}

/* ─── CONSTANTS ───────────────────────────────────────────────────────────── */
const PAGE_SIZE = 10;

const aTag = {
  "1st Alarm": "t-a1", "2nd Alarm": "t-a2", "3rd Alarm": "t-a3",
  "4th Alarm": "t-a4", "5th Alarm": "t-a5",
  "EUA": "t-eua", "FOA": "t-foa", "FOUA": "t-foa", "N/A": "t-na"
};
const iTag = { "Structural": "t-s", "Non-Structural": "t-ns", "Vehicular": "t-v" };

const MONTHS = {
  JANUARY:0,FEBRUARY:1,MARCH:2,APRIL:3,MAY:4,JUNE:5,
  JULY:6,AUGUST:7,SEPTEMBER:8,OCTOBER:9,NOVEMBER:10,DECEMBER:11
};

const VALID_TYPES  = ["Structural", "Non-Structural", "Vehicular"];
const VALID_ALARMS = ["1st Alarm","2nd Alarm","3rd Alarm","4th Alarm","5th Alarm","EUA","FOA","FOUA","N/A"];

const COL_MAP = {
  "time & date":"dt","time and date":"dt","timedate":"dt","date":"dt","datetime":"dt",
  "location":"loc","address":"loc",
  "involved":"inv","type":"inv","incident type":"inv",
  "occupancy":"occ","occupancy type":"occ",
  "estimated damage":"dmg","damage":"dmg","est. damage":"dmg",
  "estimated damage (php)":"dmg","estimated damage (₱)":"dmg","estimated damage (p)":"dmg",
  "injured civ":"injc","injured - civilian":"injc","injured civilian":"injc","inj civ":"injc","injuredciv":"injc",
  "injured bfp":"injb","injured - bfp":"injb","inj bfp":"injb","injuredbfp":"injb",
  "casualty civ":"casc","casualty - civilian":"casc","casualty civilian":"casc","cas civ":"casc","casualtyciv":"casc",
  "casualty bfp":"casb","casualty - bfp":"casb","cas bfp":"casb","casualtybfp":"casb",
  "station no.":"sta","station no":"sta","station":"sta",
  "engine no.":"eng","engine no":"eng","engine":"eng",
  "alarm status":"alarm","alarm":"alarm",
  "inputted by":"by","input by":"by","entered by":"by","encoded by":"by","inputtedby":"by",
  "remarks":"rem","remark":"rem","notes":"rem","note":"rem"
};

/* ─── HELPERSS ─────────────────────────────────────────────────────────────── */
function peso(n)      { return "₱" + n.toLocaleString("en-PH"); }
function pesoRaw(s)   { return parseInt(String(s).replace(/[^\d]/g,"")) || 0; }

function parseDt(dt) {
  const m = dt.match(/(\d+)H\s+(\d{1,2})-([A-Z]+)-(\d{4})/i);
  if (!m) return null;
  const timeStr = m[1];
  const day = parseInt(m[2]), mon = MONTHS[(m[3]||"").toUpperCase()], yr = parseInt(m[4]);
  if (mon === undefined) return null;
  const hr  = timeStr.length >= 3 ? parseInt(timeStr.slice(0, timeStr.length - 2)) : 0;
  const min = parseInt(timeStr.slice(-2)) || 0;
  return new Date(yr, mon, day, hr, min);
}
function dtToYMD(dt) {
  const d = parseDt(dt); if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function dtToYM(dt)   { const ymd = dtToYMD(dt); return ymd ? ymd.slice(0,7) : null; }
function dtToYear(dt) { const m = dt.match(/(\d{4})$/); return m ? m[1] : null; }

function normHeader(h) { return String(h||"").trim().toLowerCase(); }

function buildHeaderMap(headers) {
  const map = {};
  headers.forEach(h => { const norm = normHeader(h); if (COL_MAP[norm]) map[h] = COL_MAP[norm]; });
  return map;
}
function mapRow(rowObj, headerMap) {
  const out = {};
  for (const [origH, val] of Object.entries(rowObj)) {
    const key = headerMap[origH];
    if (key) out[key] = val;
  }
  return out;
}
function validateRow(mapped, rowNum) {
  const req = ["dt","loc","inv","occ","dmg","sta","eng","alarm","by"];
  for (const f of req) {
    const v = mapped[f];
    if (v === undefined || v === null || String(v).trim() === "")
      return { ok:false, reason:`Row ${rowNum}: missing required field "${f}"` };
  }
  const inv = String(mapped.inv||"").trim();
  const normInv = VALID_TYPES.find(t => t.toLowerCase() === inv.toLowerCase());
  if (!normInv) return { ok:false, reason:`Row ${rowNum}: "Involved" must be Structural / Non-Structural / Vehicular (got "${inv}")` };
  const alarm = String(mapped.alarm||"").trim();
  const normAlarm = VALID_ALARMS.find(a => a.toLowerCase() === alarm.toLowerCase());
  if (!normAlarm) return { ok:false, reason:`Row ${rowNum}: "Alarm Status" invalid value "${alarm}"` };
  return {
    ok:true,
    rec:{
      dt:     String(mapped.dt||"").trim(),
      loc:    String(mapped.loc||"").trim(),
      inv:    normInv,
      occ:    String(mapped.occ||"").trim(),
      dmgRaw: pesoRaw(mapped.dmg),
      alarm:  normAlarm,
      sta:    String(mapped.sta||"").trim(),
      eng:    String(mapped.eng||"").trim(),
      by:     String(mapped.by||"").trim(),
      injC:   parseInt(mapped.injc)||0,
      injB:   parseInt(mapped.injb)||0,
      casC:   parseInt(mapped.casc)||0,
      casB:   parseInt(mapped.casb)||0,
      rem:    String(mapped.rem||"").trim()
    }
  };
}
function splitCSVLine(line) {
  const result = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === "," && !inQ) { result.push(cur); cur = ""; }
    else cur += ch;
  }
  result.push(cur);
  return result.map(s => s.trim());
}
function parseCSVString(text) {
  const lines = text.split(/\r?\n/);
  let headers = null;
  const rows = [];
  for (const line of lines) {
    const cells = splitCSVLine(line);
    if (!cells.length || cells.every(c => !c)) continue;
    if (!headers) {
      const hasKnown = cells.some(c => !!COL_MAP[normHeader(c)]);
      if (hasKnown) { headers = cells; }
      continue;
    }
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] !== undefined ? cells[i] : ""; });
    rows.push(obj);
  }
  return { headers: headers || [], rows };
}
function parseXLSXData(arrayBuffer) {
  const wb  = window.XLSX.read(arrayBuffer, { type:"array" });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = window.XLSX.utils.sheet_to_json(ws, { header:1, defval:"" });
  if (!raw.length) return { headers:[], rows:[] };
  let headerRowIdx = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].some(c => !!COL_MAP[normHeader(String(c))])) { headerRowIdx = i; break; }
  }
  if (headerRowIdx < 0) return { headers:[], rows:[] };
  const headers = raw[headerRowIdx].map(c => String(c).trim());
  const rows = [];
  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const cells = raw[i];
    if (cells.every(c => !String(c).trim())) continue;
    const obj = {};
    headers.forEach((h, j) => { obj[h] = String(cells[j] !== undefined ? cells[j] : "").trim(); });
    rows.push(obj);
  }
  return { headers, rows };
}

/* ─── API ↔ LOCAL FORMAT CONVERTERS ──────────────────────────────────────── */
// Django field names → local React shape
function apiToLocal(r, idx) {
  return {
    id:     r.id,
    no:     idx + 1,
    dt:     r.dt,
    loc:    r.loc,
    inv:    r.inv,
    occ:    r.occ,
    dmgRaw: r.dmg_raw,
    alarm:  r.alarm,
    sta:    r.sta,
    eng:    r.eng,
    by:     r.by_user,
    injC:   r.inj_c,
    injB:   r.inj_b,
    casC:   r.cas_c,
    casB:   r.cas_b,
    rem:    r.rem || "",
  };
}
// Local React shape → Django field names
function localToApi(rec) {
  return {
    dt:      rec.dt,
    loc:     rec.loc,
    inv:     rec.inv,
    occ:     rec.occ,
    dmg_raw: rec.dmgRaw,
    alarm:   rec.alarm,
    sta:     rec.sta,
    eng:     rec.eng,
    by_user: rec.by,
    inj_c:   rec.injC,
    inj_b:   rec.injB,
    cas_c:   rec.casC,
    cas_b:   rec.casB,
    rem:     rec.rem || "",
  };
}

function sortChronologically(data) {
  return [...data].sort((a, b) => {
    const da = parseDt(a.dt), db = parseDt(b.dt);
    if (da && db) return da - db;
    if (da) return -1;
    if (db) return  1;
    return (a.no || 0) - (b.no || 0);
  });
}
function buildReportCSV(data, preparedBy, rank) {
  const now     = new Date();
  const genDate = now.toLocaleDateString("en-PH",{year:"numeric",month:"long",day:"numeric"});
  const titleLines = [
    '"BUREAU OF FIRE PROTECTION"',
    '"Cagayan de Oro City Fire Station"',
    '"FIRE INCIDENT REPORT"',
    `"Generated: ${genDate}"`,
    preparedBy ? `"Prepared By: ${preparedBy}${rank ? " (" + rank + ")" : ""}"` : "",
    '""'
  ].filter(Boolean);
  const cols = ["No.","Time & Date","Location","Involved","Occupancy",
    "Estimated Damage (PHP)","Injured - Civilian","Injured - BFP","Injured - Total",
    "Casualty - Civilian","Casualty - BFP","Casualty - Total",
    "Station No.","Engine No.","Alarm Status","Inputted By","Remarks"];
  const sorted = sortChronologically(data);
  const rows = sorted.map((r, idx) => [
    idx + 1, `"${r.dt}"`, `"${r.loc}"`, r.inv, `"${r.occ}"`,
    r.dmgRaw, r.injC, r.injB, r.injC + r.injB,
    r.casC, r.casB, r.casC + r.casB,
    `"${r.sta}"`, `"${r.eng}"`, r.alarm, `"${r.by}"`, `"${r.rem || ""}"`
  ].join(","));
  const totDmg  = data.reduce((s,r) => s+r.dmgRaw, 0);
  const totInjC = data.reduce((s,r) => s+r.injC, 0);
  const totInjB = data.reduce((s,r) => s+r.injB, 0);
  const totCasC = data.reduce((s,r) => s+r.casC, 0);
  const totCasB = data.reduce((s,r) => s+r.casB, 0);
  const summaryLines = [
    '""', '"--- SUMMARY TOTALS ---"',
    `"Total Incidents:","${data.length}"`,
    `"Structural:","${data.filter(r=>r.inv==="Structural").length}"`,
    `"Non-Structural:","${data.filter(r=>r.inv==="Non-Structural").length}"`,
    `"Vehicular:","${data.filter(r=>r.inv==="Vehicular").length}"`,
    `"Total Estimated Damage:","${peso(totDmg)}"`,
    `"Total Injured (Civilian):","${totInjC}"`,
    `"Total Injured (BFP):","${totInjB}"`,
    `"Total Injured:","${totInjC+totInjB}"`,
    `"Total Casualties (Civilian):","${totCasC}"`,
    `"Total Casualties (BFP):","${totCasB}"`,
    `"Total Casualties:","${totCasC+totCasB}"`
  ];
  return [...titleLines, cols.join(","), ...rows, ...summaryLines].join("\n");
}
function dlFile(name, content, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content],{type:mime}));
  a.download = name; a.click();
}
function downloadTemplate() {
  const hdr    = "Time & Date,Location,Involved,Occupancy,Estimated Damage,Injured Civ,Injured BFP,Casualty Civ,Casualty BFP,Station No.,Engine No.,Alarm Status,Inputted By,Remarks";
  const sample = '"1200H 01-JANUARY-2026","Brgy. Example, CDO City",Structural,Residential House,150000,0,0,0,0,Station 1,BFP-CDO-01,1st Alarm,"FO1 Juan Dela Cruz",Sample remark';
  const notes  = [
    '""','"--- FIELD NOTES ---"',
    '"Time & Date","Format: HHHHH DD-MONTHNAME-YYYY  e.g. 1200H 01-JANUARY-2026"',
    '"Location","Full address including barangay and city"',
    '"Involved","Structural / Non-Structural / Vehicular"',
    '"Estimated Damage","Numeric value only (no peso sign or commas)"',
    '"Alarm Status","1st Alarm / 2nd Alarm / 3rd Alarm / 4th Alarm / 5th Alarm / EUA / FOA / FOUA / N/A"',
    '"Injured Civ / Injured BFP / Casualty Civ / Casualty BFP","Numeric value (0 if none)"'
  ];
  dlFile("firs_template.csv",
    ['"FIRS Bulk Upload Template"','"Bureau of Fire Protection — Cagayan de Oro City"','""',hdr,sample,...notes].join("\n"),
    "text/csv");
}

/* ─── SVG ICONS ───────────────────────────────────────────────────────────── */
const FlameIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0d2b55" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2C9 7 7 10 7 14a5 5 0 0010 0c0-4-2-7-5-12z"/>
  </svg>
);
const FlameIconSm = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0d2b55" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2C9 7 7 10 7 14a5 5 0 0010 0c0-4-2-7-5-12z"/>
  </svg>
);
const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
);
const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

/* ─── TOAST ───────────────────────────────────────────────────────────────── */
function Toast({ msg, show }) {
  return <div className={`toast${show ? " show" : ""}`}>{msg}</div>;
}

/* ─── CONFIRM DIALOG ──────────────────────────────────────────────────────── */
function ConfirmDialog({ open, title, msg, onOk, onCancel }) {
  return (
    <div className={`confirm-overlay${open ? " open" : ""}`}>
      <div className="confirm-box">
        <h3>{title}</h3><p>{msg}</p>
        <div className="confirm-actions">
          <button className="btn b-out" onClick={onCancel}>Cancel</button>
          <button className="btn b-navy" onClick={onOk}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

/* ─── LOGIN PAGE ──────────────────────────────────────────────────────────── */
// ✅ No hardcoded credentials — authenticates against Django /api/login/
function LoginPage({ onLogin, onForgot }) {
  const [user, setUser]     = useState("");
  const [pass, setPass]     = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr]       = useState("");
  const [loading, setLoading] = useState(false);

  async function doLogin() {
    if (!user || !pass) { setErr("Please enter your username and password."); return; }
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`${API_BASE}/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
      });
      if (!res.ok) { setErr("Incorrect username or password. Please try again."); return; }
      const data = await res.json();
      onLogin(data.token, data.display);
    } catch {
      setErr("Cannot connect to server. Make sure Django is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-header">

        <div className="auth-brand-icon">
          <img src="/BFP logo.svg" alt="BFP Logo" width="40" height="40" />
        </div>

          <h1>FIRS — Fire Incident Recording System</h1>
          <p>Bureau of Fire Protection · Cagayan de Oro City</p>
        </div>
        <div className="auth-body">
          <h2>Sign In</h2>
          <p className="auth-sub">Enter your BFP credentials to access the system.</p>
          {err && <div className="auth-err">{err}</div>}
          <div className="auth-fg">
            <label>Username</label>
            <input type="text" placeholder="Enter your username" value={user}
              onChange={e => setUser(e.target.value)} autoComplete="username"
              onKeyDown={e => e.key === "Enter" && doLogin()} />
          </div>
          <div className="auth-fg pw">
            <label>Password</label>
            <input type={showPw ? "text" : "password"} placeholder="Enter your password" value={pass}
              onChange={e => setPass(e.target.value)} autoComplete="current-password"
              onKeyDown={e => e.key === "Enter" && doLogin()} />
            <button className="pw-toggle" onClick={() => setShowPw(!showPw)} type="button" tabIndex={-1}>
              {showPw ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          <div className="auth-row">
            <label><input type="checkbox" /> Remember me</label>
            <button className="auth-link" onClick={onForgot}>Forgot password?</button>
          </div>
          <button className="auth-btn" onClick={doLogin} disabled={loading}>
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── FORGOT PASSWORD PAGE (3-step: Email → OTP → Reset) ─────────────────── */
function ForgotPage({ onBack }) {
  const [step, setStep]           = useState("email");
  const [email, setEmail]         = useState("");
  const [otp, setOtp]             = useState(["","","","","",""]);
  const [newPass, setNewPass]     = useState("");
  const [confirmPass, setConfirm] = useState("");
  const [showPw, setShowPw]       = useState(false);
  const [showCPw, setShowCPw]     = useState(false);
  const [err, setErr]             = useState("");
  const [loading, setLoading]     = useState(false);
  const [success, setSuccess]     = useState(false);
  const otpRefs = useRef([]);

  /* ── Step 1: Send OTP ── */
  async function doSendOtp() {
    setErr("");
    if (!email.trim()) { setErr("Please enter your email address."); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/forgot-password/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.message || "Email not found."); return; }  // ← fix: check res.ok
      setStep("otp");
    } catch {
      setErr("Cannot connect to server. Make sure Django is running.");
    } finally {
      setLoading(false);
    }
  }

  /* ── Step 2: Verify OTP ── */
  async function doVerifyOtp() {
    setErr("");
    const code = otp.join("");
    if (code.length < 6) { setErr("Please enter the full 6-digit code."); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/verify-otp/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: code }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.message || "Invalid or expired OTP."); return; }  // ← fix: data.message not data.error
      setStep("reset");
    } catch {
      setErr("Cannot connect to server.");
    } finally {
      setLoading(false);
    }
  }

  /* ── Step 3: Reset Password ── */
  async function doResetPassword() {
    setErr("");
    if (!newPass || !confirmPass) { setErr("Please fill in both password fields."); return; }
    if (newPass.length < 8)       { setErr("Password must be at least 8 characters."); return; }
    if (newPass !== confirmPass)   { setErr("Passwords do not match."); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/reset-password/`, {   // ← fix: correct endpoint
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          otp:              otp.join(""),
          new_password:     newPass,
          confirm_password: confirmPass,   // ← fix: required by backend
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.message || "Failed to reset password."); return; }  // ← fix: data.message
      setSuccess(true);
    } catch {
      setErr("Cannot connect to server.");
    } finally {
      setLoading(false);
    }
  }

  /* ── OTP input helpers ── */
  function handleOtpChange(val, idx) {
    const cleaned = val.replace(/\D/g, "").slice(-1);
    const next = [...otp]; next[idx] = cleaned; setOtp(next);
    if (cleaned && idx < 5) otpRefs.current[idx + 1]?.focus();
  }
  function handleOtpKey(e, idx) {
    if (e.key === "Backspace" && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus();
  }
  function handleOtpPaste(e) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted) {
      setOtp(pasted.split("").concat(Array(6).fill("")).slice(0, 6));
      otpRefs.current[Math.min(pasted.length, 5)]?.focus();
      e.preventDefault();
    }
  }

  const Header = () => (
    <div className="auth-header">
      <div className="auth-brand-icon">
        <img src="/BFP logo.svg" alt="BFP Logo" width="40" height="40" />
      </div>
      <h1>FIRS — Fire Incident Recording System</h1>
      <p>Bureau of Fire Protection · Cagayan de Oro City</p>
    </div>
  );

  /* ── STEP 1: Email ── */
  if (step === "email") return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Header />
        <div className="auth-body">
          <button className="auth-back" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            Back to Sign In
          </button>
          <h2>Forgot Password</h2>
          <p className="auth-sub">Enter your registered BFP email address and we'll send a verification code.</p>
          {err && <div className="auth-err">{err}</div>}
          <div className="auth-fg">
            <label>Email Address</label>
            <input type="email" placeholder="Enter your registered email"
              value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSendOtp()} autoFocus />
          </div>
          <button className="auth-btn" onClick={doSendOtp} disabled={loading} style={{marginTop:8}}>
            {loading ? "Sending…" : "Send Verification Code"}
          </button>
        </div>
        <div className="auth-footer">You'll receive a 6-digit code valid for <strong>10 minutes</strong>.</div>
      </div>
    </div>
  );

  /* ── STEP 2: OTP ── */
  if (step === "otp") return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Header />
        <div className="auth-body">
          <button className="auth-back" onClick={() => { setStep("email"); setErr(""); setOtp(["","","","","",""]); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <h2>Enter Verification Code</h2>
          <p className="auth-sub">A 6-digit code was sent to <strong style={{color:"var(--navy)"}}>{email}</strong>. Check your inbox.</p>
          {err && <div className="auth-err">{err}</div>}
          <div className="otp-row">
            {otp.map((digit, idx) => (
              <input key={idx} type="text" inputMode="numeric" maxLength={1}
                className="otp-box" value={digit}
                ref={el => otpRefs.current[idx] = el}
                onChange={e => handleOtpChange(e.target.value, idx)}
                onKeyDown={e => handleOtpKey(e, idx)}
                onPaste={idx === 0 ? handleOtpPaste : undefined}
                autoFocus={idx === 0} />
            ))}
          </div>
          <button className="auth-btn" onClick={doVerifyOtp} disabled={loading} style={{marginTop:20}}>
            {loading ? "Verifying…" : "Verify Code"}
          </button>
          <div style={{textAlign:"center",marginTop:14}}>
            <button className="auth-link" onClick={doSendOtp} disabled={loading}>Resend code</button>
          </div>
        </div>
        <div className="auth-footer">Didn't receive it? Check your spam folder or <strong>resend</strong>.</div>
      </div>
    </div>
  );

  /* ── STEP 3: New Password ── */
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Header />
        <div className="auth-body">
          {!success ? (
            <>
              <h2>Set New Password</h2>
              <p className="auth-sub">Choose a strong password for your BFP account.</p>
              {err && <div className="auth-err">{err}</div>}
              <div className="auth-fg pw">
                <label>New Password</label>
                <input type={showPw ? "text" : "password"} placeholder="At least 8 characters"
                  value={newPass} onChange={e => setNewPass(e.target.value)} />
                <button className="pw-toggle" onClick={() => setShowPw(!showPw)} type="button" tabIndex={-1}>
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              <div className="auth-fg pw">
                <label>Confirm Password</label>
                <input type={showCPw ? "text" : "password"} placeholder="Repeat new password"
                  value={confirmPass} onChange={e => setConfirm(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && doResetPassword()} />
                <button className="pw-toggle" onClick={() => setShowCPw(!showCPw)} type="button" tabIndex={-1}>
                  {showCPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              <button className="auth-btn" onClick={doResetPassword} disabled={loading} style={{marginTop:8}}>
                {loading ? "Updating…" : "Reset Password"}
              </button>
            </>
          ) : (
            <div style={{textAlign:"center",padding:"20px 0"}}>
              <div style={{width:56,height:56,background:"var(--green-soft)",borderRadius:"50%",display:"grid",placeItems:"center",margin:"0 auto 16px"}}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#12804a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h2 style={{marginBottom:8}}>Password Updated!</h2>
              <p className="auth-sub">Your password has been reset successfully.</p>
              <button className="auth-btn" onClick={onBack} style={{marginTop:20}}>Back to Sign In</button>
            </div>
          )}
        </div>
        {!success && <div className="auth-footer">Password must be at least <strong>8 characters</strong>.</div>}
      </div>
    </div>
  );
}

/* ─── INCIDENT MODAL ──────────────────────────────────────────────────────── */
function IncidentModal({ open, editRec, onClose, onSave }) {
  const blank = { dt:"",loc:"",inv:"",occ:"",dmg:"",alarm:"",injC:"",injB:"",casC:"",casB:"",sta:"",eng:"",by:"",rem:"" };
  const [f, setF] = useState(blank);
  const [formErr, setFormErr] = useState("");

  useEffect(() => {
    if (open) {
      if (editRec) {
        setF({ dt:editRec.dt, loc:editRec.loc, inv:editRec.inv, occ:editRec.occ,
          dmg:editRec.dmgRaw, alarm:editRec.alarm, injC:editRec.injC, injB:editRec.injB,
          casC:editRec.casC, casB:editRec.casB, sta:editRec.sta, eng:editRec.eng,
          by:editRec.by, rem:editRec.rem });
      } else {
        setF(blank);
      }
      setFormErr("");
    }
  }, [open, editRec]);

  function upd(k, v) { setF(prev => ({...prev, [k]:v})); }

  function save() {
    if (!f.dt||!f.loc||!f.inv||!f.occ||!f.dmg||!f.alarm||!f.sta||!f.eng||!f.by) {
      setFormErr("Please fill in all required fields."); return;
    }
    setFormErr("");
    onSave({
      dt:f.dt, loc:f.loc, inv:f.inv, occ:f.occ, dmgRaw:pesoRaw(f.dmg),
      alarm:f.alarm, sta:f.sta, eng:f.eng, by:f.by,
      injC:parseInt(f.injC)||0, injB:parseInt(f.injB)||0,
      casC:parseInt(f.casC)||0, casB:parseInt(f.casB)||0, rem:f.rem
    });
  }

  return (
    <div className={`overlay${open ? " open" : ""}`} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <div className="mh-title">{editRec ? `Edit Incident — No. ${editRec.no}` : "Encode New Incident"}</div>
          <button className="mx" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="fgrid2">
            <div className="fg full"><label>Time &amp; Date <span className="req">*</span></label><input type="text" placeholder="e.g. 1200H 01-JANUARY-2026" value={f.dt} onChange={e => upd("dt",e.target.value)} /></div>
            <div className="fg full"><label>Location <span className="req">*</span></label><input type="text" placeholder="Barangay, Street, City" value={f.loc} onChange={e => upd("loc",e.target.value)} /></div>
            <div className="fg"><label>Involved <span className="req">*</span></label>
              <select value={f.inv} onChange={e => upd("inv",e.target.value)}>
                <option value="">Select…</option><option>Structural</option><option>Non-Structural</option><option>Vehicular</option>
              </select>
            </div>
            <div className="fg"><label>Occupancy <span className="req">*</span></label><input type="text" placeholder="e.g. Residential House" value={f.occ} onChange={e => upd("occ",e.target.value)} /></div>
            <div className="fg"><label>Estimated Damage (₱) <span className="req">*</span></label><input type="text" placeholder="e.g. 150000" value={f.dmg} onChange={e => upd("dmg",e.target.value)} /></div>
            <div className="fg"><label>Alarm Status <span className="req">*</span></label>
              <select value={f.alarm} onChange={e => upd("alarm",e.target.value)}>
                <option value="">Select…</option><option>1st Alarm</option><option>2nd Alarm</option><option>3rd Alarm</option><option>4th Alarm</option><option>5th Alarm</option><option>EUA</option><option>FOA</option><option>FOUA</option><option>N/A</option>
              </select>
            </div>
            <div className="fg"><label>Injured — Civilian</label><input type="number" placeholder="0" min="0" value={f.injC} onChange={e => upd("injC",e.target.value)} /></div>
            <div className="fg"><label>Injured — BFP</label><input type="number" placeholder="0" min="0" value={f.injB} onChange={e => upd("injB",e.target.value)} /></div>
            <div className="fg"><label>Casualty — Civilian</label><input type="number" placeholder="0" min="0" value={f.casC} onChange={e => upd("casC",e.target.value)} /></div>
            <div className="fg"><label>Casualty — BFP</label><input type="number" placeholder="0" min="0" value={f.casB} onChange={e => upd("casB",e.target.value)} /></div>
            <div className="fg"><label>Station No. <span className="req">*</span></label><input type="text" placeholder="e.g. Station 4" value={f.sta} onChange={e => upd("sta",e.target.value)} /></div>
            <div className="fg"><label>Engine No. <span className="req">*</span></label><input type="text" placeholder="e.g. BFP-CDO-09" value={f.eng} onChange={e => upd("eng",e.target.value)} /></div>
            <div className="fg full"><label>Inputted By <span className="req">*</span></label><input type="text" placeholder="e.g. FO1 Hazel Butlay" value={f.by} onChange={e => upd("by",e.target.value)} /></div>
            <div className="fg full"><label>Remarks <span style={{fontWeight:400,textTransform:"none",letterSpacing:0,fontSize:11}}>(optional)</span></label>
              <textarea placeholder="Additional details about the incident…" value={f.rem} onChange={e => upd("rem",e.target.value)} />
            </div>
          </div>
          {formErr && <div style={{marginTop:12,fontSize:13,color:"var(--red)"}}>{formErr}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn b-out" onClick={onClose}>Cancel</button>
          <button className="btn b-navy" onClick={save}>Save Incident</button>
        </div>
      </div>
    </div>
  );
}

/* ─── DASHBOARD VIEW ──────────────────────────────────────────────────────── */
function DashboardView({ incidents, onViewAll, onAddIncident }) {
  const dmg  = incidents.reduce((s,r) => s+r.dmgRaw, 0);
  const injC = incidents.reduce((s,r) => s+r.injC, 0);
  const injB = incidents.reduce((s,r) => s+r.injB, 0);
  const casC = incidents.reduce((s,r) => s+r.casC, 0);
  const casB = incidents.reduce((s,r) => s+r.casB, 0);
  const recent = [...incidents].reverse().slice(0,5);

  return (
    <div className="view">
      <div className="page-heading"><h1>Dashboard</h1><p>Fire incident overview · Cagayan de Oro City</p></div>
      <div className="stats-row1">
        <div className="stat-card c-blue"><div className="stat-label">Total Incidents</div><div className="stat-value">{incidents.length}</div><div className="stat-sub">All recorded incidents</div></div>
        <div className="stat-card c-yellow"><div className="stat-label">Total Damage</div><div className="stat-value dmg">{peso(dmg)}</div><div className="stat-sub">Estimated value</div></div>
        <div className="stat-card c-red"><div className="stat-label">Total Injured</div><div className="stat-value">{injC+injB}</div><div className="stat-sub">Civilian {injC} · BFP {injB}</div></div>
        <div className="stat-card c-green"><div className="stat-label">Total Casualties</div><div className="stat-value">{casC+casB}</div><div className="stat-sub">Civilian {casC} · BFP {casB}</div></div>
      </div>
      <div className="stats-row2">
        <div className="type-card">
          <div><div className="type-count">{incidents.filter(r=>r.inv==="Structural").length}</div><div className="type-name">Structural</div></div>
          <div className="type-icon ti-s"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1a4f9e" strokeWidth="1.8"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg></div>
        </div>
        <div className="type-card">
          <div><div className="type-count">{incidents.filter(r=>r.inv==="Non-Structural").length}</div><div className="type-name">Non-Structural</div></div>
          <div className="type-icon ti-n"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#12804a" strokeWidth="1.8"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></div>
        </div>
        <div className="type-card">
          <div><div className="type-count">{incidents.filter(r=>r.inv==="Vehicular").length}</div><div className="type-name">Vehicular</div></div>
          <div className="type-icon ti-v"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#92600a" strokeWidth="1.8"><path d="M5 17H3v-5l2-5h14l2 5v5h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/></svg></div>
        </div>
      </div>
      <div className="section-card">
        <div className="section-header">
          <div className="section-title">Recent Incidents</div>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <span className="section-meta">Showing latest 5</span>
            <button className="btn b-out b-sm" onClick={onViewAll}>View All</button>
          </div>
        </div>
        <div className="tscroll">
          <table>
            <thead><tr><th>No.</th><th>Time &amp; Date</th><th>Location</th><th>Involved</th><th>Alarm Status</th><th>Estimated Damage</th></tr></thead>
            <tbody>
              {recent.length ? recent.map(r => (
                <tr key={r.id}>
                  <td className="num">{r.no}</td>
                  <td className="dtime">{r.dt}</td>
                  <td>{r.loc}</td>
                  <td><span className={`tag ${iTag[r.inv]||""}`}>{r.inv}</span></td>
                  <td><span className={`tag ${aTag[r.alarm]||"t-na"}`}>{r.alarm}</span></td>
                  <td className="money">{peso(r.dmgRaw)}</td>
                </tr>
              )) : (
                <tr><td colSpan={6}><div className="empty-state">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/></svg>
                  <p>No incidents recorded yet.</p><small>Use "Encode Incident" to add your first record.</small>
                </div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── INCIDENTS VIEW ──────────────────────────────────────────────────────── */
function IncidentsView({ incidents, onAddIncident, onEdit, onDelete, availableYears }) {
  const [search, setSearch]    = useState("");
  const [fType, setFType]      = useState("");
  const [fAlarm, setFAlarm]    = useState("");
  const [fYear, setFYear]      = useState("");
  const [fDate, setFDate]      = useState("");
  const [currentPage, setPage] = useState(1);

  const filtered = incidents.filter(r => {
    const q = search.toLowerCase();
    const mQ = !q || [r.loc,r.rem,r.alarm,r.inv,r.by,r.occ,r.sta,r.eng].some(v => String(v||"").toLowerCase().includes(q));
    if (!mQ) return false;
    if (fType  && r.inv   !== fType)  return false;
    if (fAlarm && r.alarm !== fAlarm) return false;
    if (fYear  && dtToYear(r.dt)     !== fYear)  return false;
    if (fDate  && dtToYMD(r.dt)      !== fDate)  return false;
    return true;
  });

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page  = Math.min(currentPage, pages);
  const slice = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  const hasFilter = search||fType||fAlarm||fYear||fDate;
  function clearAll() { setSearch(""); setFType(""); setFAlarm(""); setFYear(""); setFDate(""); setPage(1); }

  const totalDmg = filtered.reduce((s,r) => s+r.dmgRaw, 0);
  const totalInj = filtered.reduce((s,r) => s+r.injC+r.injB, 0);
  const totalCas = filtered.reduce((s,r) => s+r.casC+r.casB, 0);

  function exportCSV() {
    if (!filtered.length) return;
    dlFile("firs_incidents_export.csv", buildReportCSV(filtered,"",""), "text/csv");
  }

  return (
    <div className="view">
      <div className="page-heading"><h1>Incident Records</h1><p>Full chronological list of all recorded fire incidents.</p></div>
      <div className="toolbar">
        <div className="search-wrap">
          <svg className="si" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search location, occupancy, remarks…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          {search && <button className="sc" onClick={() => { setSearch(""); setPage(1); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>}
        </div>
        <div className="filter-row">
          <select className={fType?"af":""} value={fType} onChange={e => { setFType(e.target.value); setPage(1); }}>
            <option value="">All Types</option><option>Structural</option><option>Non-Structural</option><option>Vehicular</option>
          </select>
          <select className={fAlarm?"af":""} value={fAlarm} onChange={e => { setFAlarm(e.target.value); setPage(1); }}>
            <option value="">All Alarms</option>
            {["1st Alarm","2nd Alarm","3rd Alarm","4th Alarm","5th Alarm","EUA","FOA","FOUA","N/A"].map(a => <option key={a}>{a}</option>)}
          </select>
          <select className={fYear?"af":""} value={fYear} onChange={e => { setFYear(e.target.value); setPage(1); }}>
            <option value="">All Years</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <input type="date" className={fDate?"af":""} value={fDate} onChange={e => { setFDate(e.target.value); setPage(1); }} />
          {hasFilter && <button className="clear-btn" onClick={clearAll}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Clear
          </button>}
        </div>
        <button className="btn b-navy" onClick={onAddIncident} style={{marginLeft:"auto"}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Incident
        </button>
      </div>
      <div className="section-card">
        <div className="rcbar">
          <span>Showing {filtered.length} record(s)</span>
          <button className="btn b-out b-sm" onClick={exportCSV}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export CSV
          </button>
        </div>
        <div className="tscroll">
          <table>
            <thead>
              <tr><th>No.</th><th>Time &amp; Date</th><th>Location</th><th>Involved</th><th>Occupancy</th><th>Est. Damage (₱)</th><th>Injured</th><th>Casualty</th><th>Station</th><th>Engine</th><th>Alarm</th><th>Inputted By</th><th>Remarks</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {slice.length ? slice.map(r => (
                <tr key={r.id}>
                  <td className="num">{r.no}</td>
                  <td className="dtime">{r.dt}</td>
                  <td>{r.loc}</td>
                  <td><span className={`tag ${iTag[r.inv]||""}`}>{r.inv}</span></td>
                  <td style={{fontSize:13}}>{r.occ}</td>
                  <td className="money">{peso(r.dmgRaw)}</td>
                  <td style={{fontSize:13}}>Civ: {r.injC} / BFP: {r.injB}<br/><strong>Total: {r.injC+r.injB}</strong></td>
                  <td style={{fontSize:13}}>Civ: {r.casC} / BFP: {r.casB}<br/><strong>Total: {r.casC+r.casB}</strong></td>
                  <td style={{fontSize:13}}>{r.sta}</td>
                  <td style={{fontSize:13}}>{r.eng}</td>
                  <td><span className={`tag ${aTag[r.alarm]||"t-na"}`}>{r.alarm}</span></td>
                  <td style={{fontSize:13}}>{r.by}</td>
                  <td className="rem-cell" title={r.rem||""}>{r.rem||"—"}</td>
                  <td><div className="act-btns">
                    <button className="btn-edit" onClick={() => onEdit(r)}>Edit</button>
                    <button className="btn-del" onClick={() => onDelete(r)}>Delete</button>
                  </div></td>
                </tr>
              )) : (
                <tr><td colSpan={14}><div className="empty-state">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                  <p>No incidents found</p><small>Try adjusting your search or filters, or add a new incident.</small>
                </div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="tfooter">
          <div className="tsum">
            <span>Filtered Records: <strong>{filtered.length}</strong></span>
            <span>Total Damage: <strong>{peso(totalDmg)}</strong></span>
            <span>Total Injured: <strong>{totalInj}</strong></span>
            <span>Total Casualties: <strong>{totalCas}</strong></span>
          </div>
          <div className="tpages">
            {Array.from({length:pages},(_,i)=>i+1).map(p => (
              <button key={p} className={`pgbtn${p===page?" on":""}`} onClick={() => setPage(p)}>{p}</button>
            ))}
            {pages > 1 && page < pages && <button className="pgbtn" onClick={() => setPage(page+1)}>›</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── UPLOAD VIEW ─────────────────────────────────────────────────────────── */
function UploadView({ onImport, showToast }) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [pending, setPending]   = useState([]);
  const [preview, setPreview]   = useState(null);
  const fileRef = useRef();

  function processFile(file) {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["csv","xlsx","xls"].includes(ext)) { showToast("Unsupported file. Please use .xlsx or .csv"); return; }
    if (file.size > 10*1024*1024) { showToast("File too large — maximum 10 MB."); return; }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        let parsed;
        if (ext === "csv") parsed = parseCSVString(e.target.result);
        else parsed = parseXLSXData(e.target.result);
        if (!parsed.headers.length) { setPreview({ error:"Could not detect a valid header row." }); return; }
        const headerMap = buildHeaderMap(parsed.headers);
        const goodRecs=[], errors=[], skipped=[];
        parsed.rows.forEach((row, idx) => {
          const mapped = mapRow(row, headerMap);
          if (Object.keys(mapped).length===0 || Object.values(mapped).every(v=>!v)) {
            skipped.push(`Row ${idx+2}: empty, skipped`); return;
          }
          const result = validateRow(mapped, idx+2);
          if (result.ok) goodRecs.push(result.rec);
          else errors.push(result.reason);
        });
        setPending(goodRecs);
        setPreview({ goodRecs, errors, skipped, filename:file.name });
      } catch(err) {
        setPreview({ error:"Failed to parse file: "+err.message });
      }
    };
    reader.onerror = () => setPreview({ error:"Failed to read the file." });
    if (ext==="csv") reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  }

  function discard() {
    setPending([]); setPreview(null); setFileName(""); if (fileRef.current) fileRef.current.value="";
  }

  function confirmImport() {
    onImport(pending, () => { showToast(`✓ ${pending.length} incident(s) imported successfully!`); discard(); });
  }

  return (
    <div className="view">
      <div className="page-heading"><h1>Bulk Upload</h1><p>Import multiple incidents at once using Excel or CSV format.</p></div>
      <div className="up-card">
        <h3>Upload File</h3>
        <input type="file" accept=".xlsx,.xls,.csv" ref={fileRef} style={{display:"none"}} onChange={e => processFile(e.target.files[0])} />
        <div className={`drop-z${dragging?" dragover":""}`}
          onDragOver={e=>{e.preventDefault();setDragging(true);}}
          onDragLeave={e=>{e.preventDefault();setDragging(false);}}
          onDrop={e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer?.files?.[0];if(f)processFile(f);}}>
          <div className="di">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#1e4d8c" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <h4>Drag &amp; Drop your file here</h4>
          <p>Accepts .xlsx and .csv files · Max file size 10MB</p>
          <button className="drop-z-btn" onClick={() => fileRef.current?.click()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Browse File
          </button>
        </div>
        {fileName && (
          <div className="file-selected-bar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#12804a" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>{fileName}</span>
            <button onClick={discard}>&times;</button>
          </div>
        )}
        {preview && !preview.error && (
          <div className="upload-result">
            <div className="upload-result-header">
              <h4>📄 {preview.filename}</h4>
              <div className="upload-badges">
                <span className="badge-ok">✓ {preview.goodRecs.length} valid record(s)</span>
                {preview.errors.length>0 && <span className="badge-err">✗ {preview.errors.length} error(s)</span>}
                {preview.skipped.length>0 && <span className="badge-skip">— {preview.skipped.length} skipped</span>}
              </div>
            </div>
            {preview.goodRecs.length>0 && (
              <div className="upload-preview-scroll">
                <table>
                  <thead><tr><th>Time &amp; Date</th><th>Location</th><th>Involved</th><th>Occupancy</th><th>Est. Damage</th><th>Alarm</th></tr></thead>
                  <tbody>
                    {preview.goodRecs.slice(0,5).map((r,i) => (
                      <tr key={i}>
                        <td className="dtime" style={{fontSize:12}}>{r.dt}</td>
                        <td style={{fontSize:12}}>{r.loc}</td>
                        <td><span className={`tag ${iTag[r.inv]||""}`} style={{fontSize:11}}>{r.inv}</span></td>
                        <td style={{fontSize:12}}>{r.occ}</td>
                        <td className="money" style={{fontSize:12}}>₱{r.dmgRaw.toLocaleString()}</td>
                        <td><span className={`tag ${aTag[r.alarm]||"t-na"}`} style={{fontSize:11}}>{r.alarm}</span></td>
                      </tr>
                    ))}
                    {preview.goodRecs.length>5 && <tr><td colSpan={6} style={{textAlign:"center",padding:10,fontSize:12.5,color:"var(--text-light)"}}>…and {preview.goodRecs.length-5} more record(s)</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {preview.errors.length>0 && (
              <div className="upload-err-list">
                <p>⚠️ {preview.errors.length} row(s) had issues and were skipped:</p>
                <ul>{preview.errors.slice(0,10).map((e,i) => <li key={i}>{e}</li>)}
                  {preview.errors.length>10 && <li>…and {preview.errors.length-10} more</li>}
                </ul>
              </div>
            )}
            <div className="upload-actions">
              {preview.goodRecs.length>0 && (
                <button className="btn b-navy" onClick={confirmImport}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  Import {preview.goodRecs.length} Record(s)
                </button>
              )}
              <button className="discard-btn" onClick={discard}>Discard</button>
            </div>
          </div>
        )}
        {preview?.error && (
          <div className="upload-result">
            <div className="upload-result-header" style={{background:"#fdf0ee"}}>
              <h4 style={{color:"var(--red)"}}>❌ Error</h4>
            </div>
            <div style={{padding:"16px 18px",fontSize:13.5,color:"var(--red)"}}>{preview.error}</div>
          </div>
        )}
      </div>
      <div className="up-card">
        <h3>Required Columns</h3>
        <div className="fgrid">
          {["Time & Date","Location","Involved","Occupancy","Estimated Damage","Injured Civ","Injured BFP","Casualty Civ","Casualty BFP","Station No.","Engine No.","Alarm Status","Inputted By"].map(c => (
            <div key={c} className="fitem"><span className="fdot"></span>{c}</div>
          ))}
          <div className="fitem opt"><span className="fdot"></span>Remarks (optional)</div>
        </div>
        <div style={{marginTop:18}}>
          <button className="btn b-mustard" onClick={() => { downloadTemplate(); showToast("Template downloaded."); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download Template
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── REPORTS VIEW ────────────────────────────────────────────────────────── */
function ReportsView({ incidents, availableYears, onGoAnnual, showToast }) {
  const [repTab, setRepTab]         = useState("specific");
  const [rptDate, setRptDate]       = useState("");
  const [rptType, setRptType]       = useState("");
  const [rptMonth, setRptMonth]     = useState("");
  const [rptMonthType, setRptMonthType] = useState("");
  const [rptYear, setRptYear]       = useState("");
  const [rptYearType, setRptYearType] = useState("");
  const [rptFrom, setRptFrom]       = useState("");
  const [rptTo, setRptTo]           = useState("");
  const [rptCustomType, setRptCustomType] = useState("");
  const [rptAllType, setRptAllType] = useState("");
  const [rptBy, setRptBy]           = useState("");
  const [rptRank, setRptRank]       = useState("");

  function getReportData() {
    switch(repTab) {
      case "specific": return incidents.filter(r => (!rptDate||dtToYMD(r.dt)===rptDate) && (!rptType||r.inv===rptType));
      case "monthly":  return incidents.filter(r => (!rptMonth||dtToYM(r.dt)===rptMonth) && (!rptMonthType||r.inv===rptMonthType));
      case "yearly":   return incidents.filter(r => (!rptYear||dtToYear(r.dt)===rptYear) && (!rptYearType||r.inv===rptYearType));
      case "custom":   return incidents.filter(r => {
        const ymd = dtToYMD(r.dt);
        return (!rptFrom||!ymd||ymd>=rptFrom) && (!rptTo||!ymd||ymd<=rptTo) && (!rptCustomType||r.inv===rptCustomType);
      });
      default: return incidents.filter(r => !rptAllType||r.inv===rptAllType);
    }
  }

  const data = getReportData();
  const dmg = data.reduce((s,r) => s+r.dmgRaw, 0);

  function generate() {
    if (!data.length) { showToast("No records match the selected filters."); return; }
    dlFile(`firs_report_${repTab}_${Date.now()}.csv`, buildReportCSV(data,rptBy,rptRank), "text/csv");
    showToast(`Report generated — ${data.length} records exported.`);
  }
  function quickMonthly() {
    const now = new Date();
    const ym  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const d   = incidents.filter(r => dtToYM(r.dt)===ym);
    if (!d.length) { showToast("No records found for this period."); return; }
    dlFile(`firs_report_${ym}.csv`, buildReportCSV(d,"",""), "text/csv");
    showToast(`Quick report exported — ${d.length} records.`);
  }
  function exportAll() {
    if (!incidents.length) { showToast("No records to export."); return; }
    dlFile("firs_incidents_export.csv", buildReportCSV(incidents,"",""), "text/csv");
    showToast(`CSV exported — ${incidents.length} record(s).`);
  }

  const typeSelect = (val, setter) => (
    <select value={val} onChange={e => setter(e.target.value)}>
      <option value="">All Types</option><option>Structural</option><option>Non-Structural</option><option>Vehicular</option>
    </select>
  );

  return (
    <div className="view">
      <div className="page-heading"><h1>Excel Report</h1><p>Generate and download filtered reports with complete incident details and summary totals.</p></div>
      <div className="rep-config">
        <h3>Configure Report</h3>
        <div className="rep-type-tabs">
          {["specific","monthly","yearly","custom","all"].map(t => (
            <button key={t} className={`rep-tab${repTab===t?" active":""}`} onClick={() => setRepTab(t)}>
              {t==="specific"?"Specific Date":t==="monthly"?"Monthly":t==="yearly"?"Yearly":t==="custom"?"Custom Range":"All Records"}
            </button>
          ))}
        </div>
        {repTab==="specific" && <div className="rep-fields two-col"><div className="fg"><label>Specific Date</label><input type="date" value={rptDate} onChange={e=>setRptDate(e.target.value)} /></div><div className="fg"><label>Incident Type</label>{typeSelect(rptType, setRptType)}</div></div>}
        {repTab==="monthly"  && <div className="rep-fields two-col"><div className="fg"><label>Month</label><input type="month" value={rptMonth} onChange={e=>setRptMonth(e.target.value)} /></div><div className="fg"><label>Incident Type</label>{typeSelect(rptMonthType, setRptMonthType)}</div></div>}
        {repTab==="yearly"   && <div className="rep-fields two-col"><div className="fg"><label>Year</label><select value={rptYear} onChange={e=>setRptYear(e.target.value)}><option value="">All Years</option>{availableYears.map(y=><option key={y} value={y}>{y}</option>)}</select></div><div className="fg"><label>Incident Type</label>{typeSelect(rptYearType, setRptYearType)}</div></div>}
        {repTab==="custom"   && <div className="rep-fields"><div className="fg"><label>From Date</label><input type="date" value={rptFrom} onChange={e=>setRptFrom(e.target.value)} /></div><div className="fg"><label>To Date</label><input type="date" value={rptTo} onChange={e=>setRptTo(e.target.value)} /></div><div className="fg"><label>Incident Type</label>{typeSelect(rptCustomType, setRptCustomType)}</div></div>}
        {repTab==="all"      && <div className="rep-fields two-col"><div className="fg"><label>Incident Type</label>{typeSelect(rptAllType, setRptAllType)}</div><div className="fg"><label>&nbsp;</label><p style={{fontSize:13,color:"var(--text-light)",paddingTop:10}}>Export all records in the system.</p></div></div>}
        <div className="rep-fields two-col" style={{marginTop:4}}>
          <div className="fg"><label>Prepared By</label><input type="text" placeholder="Full name of preparer" value={rptBy} onChange={e=>setRptBy(e.target.value)} /></div>
          <div className="fg"><label>Position / Rank</label><input type="text" placeholder="e.g. Fire Officer II" value={rptRank} onChange={e=>setRptRank(e.target.value)} /></div>
        </div>
        <div className="preview-panel">
          <h4>Preview</h4>
          <div className="preview-stat">
            <span>Matching Records: <strong>{data.length}</strong></span>
            <span>Total Damage: <strong>{peso(dmg)}</strong></span>
            <span>Total Injured: <strong>{data.reduce((s,r)=>s+r.injC+r.injB,0)}</strong></span>
            <span>Total Casualties: <strong>{data.reduce((s,r)=>s+r.casC+r.casB,0)}</strong></span>
          </div>
        </div>
        <div style={{marginTop:18,display:"flex",gap:10}}>
          <button className="btn b-navy" onClick={generate}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Generate &amp; Download Report
          </button>
          <button className="btn b-out">Refresh Preview</button>
        </div>
      </div>
      <div className="rep-grid">
        <div className="rep-card" onClick={quickMonthly}><div className="ri"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><h4>Quick Monthly</h4><p>Export this month's incidents instantly as a formatted CSV</p></div>
        <div className="rep-card" onClick={onGoAnnual}><div className="ri"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div><h4>Annual Summary</h4><p>Full year breakdown by type, damage, injuries, and casualties</p></div>
        <div className="rep-card" onClick={exportAll}><div className="ri"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div><h4>Export Current View</h4><p>Download currently filtered/displayed incident records as CSV</p></div>
      </div>
    </div>
  );
}

/* ─── ANNUAL VIEW ─────────────────────────────────────────────────────────── */
function AnnualView({ incidents, showToast }) {
  function buildAnnual() {
    const map = {};
    incidents.forEach(r => {
      const y = dtToYear(r.dt); if (!y) return;
      if (!map[y]) map[y] = { yr:y, tot:0, str:0, nst:0, veh:0, dmg:0, injC:0, injB:0, casC:0, casB:0 };
      const e = map[y]; e.tot++; e.dmg+=r.dmgRaw; e.injC+=r.injC; e.injB+=r.injB; e.casC+=r.casC; e.casB+=r.casB;
      if (r.inv==="Structural") e.str++;
      else if (r.inv==="Non-Structural") e.nst++;
      else if (r.inv==="Vehicular") e.veh++;
    });
    return Object.values(map).sort((a,b) => b.yr-a.yr);
  }
  const rows = buildAnnual();

  function exportAnnual() {
    if (!rows.length) { showToast("No annual data to export."); return; }
    const hdr  = ["Year","Total Incidents","Structural","Non-Structural","Vehicular","Total Damage (PHP)","Injured Civ","Injured BFP","Total Injured","Casualty Civ","Casualty BFP","Total Casualties"];
    const body = rows.map(r => [r.yr,r.tot,r.str,r.nst,r.veh,r.dmg,r.injC,r.injB,r.injC+r.injB,r.casC,r.casB,r.casC+r.casB].join(","));
    const totals = ["TOTAL",rows.reduce((s,r)=>s+r.tot,0),rows.reduce((s,r)=>s+r.str,0),rows.reduce((s,r)=>s+r.nst,0),rows.reduce((s,r)=>s+r.veh,0),rows.reduce((s,r)=>s+r.dmg,0),rows.reduce((s,r)=>s+r.injC,0),rows.reduce((s,r)=>s+r.injB,0),rows.reduce((s,r)=>s+r.injC+r.injB,0),rows.reduce((s,r)=>s+r.casC,0),rows.reduce((s,r)=>s+r.casB,0),rows.reduce((s,r)=>s+r.casC+r.casB,0)].join(",");
    dlFile("firs_annual_summary.csv",['"FIRS — Annual Summary Report"','"Bureau of Fire Protection, Cagayan de Oro City"','""',hdr.join(","),...body,totals].join("\n"),"text/csv");
    showToast("Annual report exported.");
  }

  return (
    <div className="view">
      <div className="page-heading"><h1>Annual Summary Report</h1><p>Yearly breakdown calculated from live incident records</p></div>
      <div className="section-card">
        <div className="tscroll">
          <table className="annual-t">
            <thead><tr><th>Year</th><th>Total Incidents</th><th>Structural</th><th>Non-Structural</th><th>Vehicular</th><th>Total Damage (₱)</th><th>Injured (Civ)</th><th>Injured (BFP)</th><th>Casualty (Civ)</th><th>Casualty (BFP)</th></tr></thead>
            <tbody>
              {rows.length ? rows.map(r => (
                <tr key={r.yr}>
                  <td className="yr">{r.yr}</td><td>{r.tot}</td><td>{r.str}</td><td>{r.nst}</td><td>{r.veh}</td>
                  <td className="money">{peso(r.dmg)}</td><td>{r.injC}</td><td>{r.injB}</td><td>{r.casC}</td><td>{r.casB}</td>
                </tr>
              )) : (
                <tr><td colSpan={10}><div className="empty-state"><p>No annual data yet.</p><small>Add incident records to generate the annual summary.</small></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ann-foot">
          <button className="btn b-mustard" onClick={exportAnnual}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export Annual Report
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN APP ────────────────────────────────────────────────────────────── */
// ✅ Token stored in memory (not hardcoded). Persisted to sessionStorage so
//    refresh doesn't force re-login during a work session.
export default function App() {
  const [page, setPage]             = useState("login");
  const [activeView, setActiveView] = useState("dashboard");
  const [token, setToken]           = useState(() => sessionStorage.getItem("firs_token") || "");
  const [displayName, setDispName]  = useState(() => sessionStorage.getItem("firs_display") || "BFP Account");
  const [incidents, setIncidents]   = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [modalOpen, setModalOpen]   = useState(false);
  const [editRec, setEditRec]       = useState(null);
  const [toast, setToast]           = useState({ msg:"", show:false });
  const [confirm, setConfirm]       = useState({ open:false, title:"", msg:"", onOk:null });
  const toastTimer = useRef(null);

  // Auto-login if token exists in session
  useEffect(() => {
    if (token) setPage("app");
  }, []);

  // Load incidents from Django whenever we enter the app
  useEffect(() => {
    if (page === "app" && token) fetchIncidents();
  }, [page, token]);

  async function fetchIncidents() {
    setLoadingData(true);
    try {
      const res = await fetch(`${API_BASE}/incidents/`, { headers: authHeaders(token) });
      if (res.status === 401) { doLogout(); return; }
      const data = await res.json();
      // data is array from Django; assign sequential no. for display
      setIncidents(data.map((r, i) => apiToLocal(r, i)));
    } catch {
      showToast("Could not load incidents. Check your connection.");
    } finally {
      setLoadingData(false);
    }
  }

  function showToast(msg) {
    setToast({ msg, show:true });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(t => ({...t, show:false})), 2800);
  }

  function showConfirm(title, msg, onOk) { setConfirm({ open:true, title, msg, onOk }); }
  function closeConfirm() { setConfirm(c => ({...c, open:false})); }

  const availableYears = [...new Set(incidents.map(r => dtToYear(r.dt)).filter(Boolean))]
    .map(Number).sort((a,b) => b-a).map(String);

  function handleLogin(tok, display) {
    sessionStorage.setItem("firs_token", tok);
    sessionStorage.setItem("firs_display", display);
    setToken(tok);
    setDispName(display);
    setPage("app");
    setActiveView("dashboard");
  }

  function doLogout() {
    sessionStorage.removeItem("firs_token");
    sessionStorage.removeItem("firs_display");
    setToken("");
    setIncidents([]);
    setPage("login");
  }

  function confirmLogout() {
    showConfirm("Log Out", "Are you sure you want to log out of FIRS?", async () => {
      try {
        await fetch(`${API_BASE}/logout/`, { method:"POST", headers: authHeaders(token) });
      } catch {}
      doLogout();
      showToast("You have been logged out.");
    });
  }

  function openAddModal() { setEditRec(null); setModalOpen(true); }
  function openEditModal(rec) { setEditRec(rec); setModalOpen(true); }

  async function handleSave(rec) {
    try {
      const payload = localToApi(rec);
      let res;
      if (editRec) {
        // PUT to update existing
        res = await fetch(`${API_BASE}/incidents/${editRec.id}/`, {
          method: "PUT",
          headers: authHeaders(token),
          body: JSON.stringify(payload),
        });
      } else {
        // POST to create new
        res = await fetch(`${API_BASE}/incidents/`, {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) { showToast("Failed to save incident. Please try again."); return; }
      await fetchIncidents();
      showToast(editRec ? `Incident updated successfully.` : `New incident saved successfully.`);
      setModalOpen(false);
    } catch {
      showToast("Network error. Could not save incident.");
    }
  }

  function handleDelete(rec) {
    showConfirm("Delete Incident",
      `Delete incident No. ${rec.no} at "${rec.loc}"? This cannot be undone.`,
      async () => {
        try {
          await fetch(`${API_BASE}/incidents/${rec.id}/`, {
            method: "DELETE",
            headers: authHeaders(token),
          });
          await fetchIncidents();
          showToast("Incident deleted.");
        } catch {
          showToast("Failed to delete incident.");
        }
      }
    );
  }

  function handleImport(recs, onDone) {
    showConfirm("Confirm Import",
      `Import ${recs.length} record(s) into the system? They will be added to existing incidents.`,
      async () => {
        try {
          // Convert bulk records to API format
          const records = recs.map(r => ({
            dt: r.dt, loc: r.loc, inv: r.inv, occ: r.occ,
            dmgRaw: r.dmgRaw, alarm: r.alarm, sta: r.sta, eng: r.eng,
            by: r.by, injC: r.injC, injB: r.injB, casC: r.casC, casB: r.casB, rem: r.rem,
          }));
          const res = await fetch(`${API_BASE}/incidents/bulk/`, {
            method: "POST",
            headers: authHeaders(token),
            body: JSON.stringify({ records }),
          });
          if (!res.ok) { showToast("Bulk import failed. Please try again."); return; }
          const data = await res.json();
          await fetchIncidents();
          showToast(`✓ ${data.imported} incident(s) imported successfully!`);
          onDone();
          setActiveView("incidents");
        } catch {
          showToast("Network error during import.");
        }
      }
    );
  }

  function go(view) { setActiveView(view); }

  if (page === "login")  return <LoginPage onLogin={handleLogin} onForgot={() => setPage("forgot")} />;
  if (page === "forgot") return <ForgotPage onBack={() => setPage("login")} />;

  return (
    <>
      <div className="app-shell">
        <div className="topbar">
          <div className="topbar-brand">
  
  <div className="brand-icon">
  <img src="/BFP logo.svg" alt="BFP Logo" width="32" height="32" />
</div>

          <div>
              <div className="brand-title">FIRS — Fire Incident Recording System</div>
              <div className="brand-sub">BFP · Cagayan de Oro City</div>
            </div>
          </div>
          <div className="topbar-right">
            <span className="topbar-user">{displayName}</span>
            <div className="avatar">BF</div>
            <button className="btn-logout" onClick={confirmLogout}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
              Log Out
            </button>
          </div>
        </div>
        <div className="layout">
          <aside className="sidebar">
            <div className="sidebar-section">
              <div className="sidebar-label">Main</div>
              <div className={`nav-item${activeView==="dashboard"?" active":""}`} onClick={() => go("dashboard")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                Dashboard
              </div>
              <div className={`nav-item${activeView==="incidents"?" active":""}`} onClick={() => go("incidents")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                Incident Records
              </div>
              <div className="nav-item" onClick={() => { go("incidents"); openAddModal(); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                Encode Incident
              </div>
            </div>
            <div className="sidebar-section">
              <div className="sidebar-label">Data</div>
              <div className={`nav-item${activeView==="upload"?" active":""}`} onClick={() => go("upload")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
                Bulk Upload
              </div>
              <div className="nav-item" onClick={() => { downloadTemplate(); showToast("Template downloaded."); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download Template
              </div>
            </div>
            <div className="sidebar-section">
              <div className="sidebar-label">Reports</div>
              <div className={`nav-item${activeView==="reports"?" active":""}`} onClick={() => go("reports")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                Excel Report
              </div>
              <div className={`nav-item${activeView==="annual"?" active":""}`} onClick={() => go("annual")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                Annual Summary
              </div>
            </div>
          </aside>
          <main className="content">
            {loadingData && (
              <div style={{padding:"40px",textAlign:"center",color:"var(--text-light)",fontSize:14}}>
                Loading incidents from server…
              </div>
            )}
            {!loadingData && activeView === "dashboard" && <DashboardView incidents={incidents} onViewAll={() => go("incidents")} onAddIncident={openAddModal} />}
            {!loadingData && activeView === "incidents" && <IncidentsView incidents={incidents} onAddIncident={openAddModal} onEdit={openEditModal} onDelete={handleDelete} availableYears={availableYears} />}
            {activeView === "upload"   && <UploadView onImport={handleImport} showToast={showToast} />}
            {activeView === "reports"  && <ReportsView incidents={incidents} availableYears={availableYears} onGoAnnual={() => go("annual")} showToast={showToast} />}
            {activeView === "annual"   && <AnnualView incidents={incidents} showToast={showToast} />}
          </main>
        </div>
      </div>

      <IncidentModal open={modalOpen} editRec={editRec} onClose={() => setModalOpen(false)} onSave={handleSave} />
      <ConfirmDialog open={confirm.open} title={confirm.title} msg={confirm.msg}
        onOk={() => { closeConfirm(); confirm.onOk && confirm.onOk(); }}
        onCancel={closeConfirm} />
      <Toast msg={toast.msg} show={toast.show} />
    </>
  );
}
