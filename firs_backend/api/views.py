import random

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.conf import settings
from django.utils import timezone
from datetime import timedelta

from rest_framework import viewsets, status
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.authtoken.models import Token

from .models import Incident, PasswordResetOTP
from .serializers import IncidentSerializer


# ─────────────────────────────────────────────────────────────────────────────
# AUTH
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    username = request.data.get('username', '').strip()
    password = request.data.get('password', '')

    if not username or not password:
        return Response(
            {'detail': 'Username and password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = authenticate(request, username=username, password=password)
    if user is None:
        return Response(
            {'detail': 'Invalid username or password.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    if not user.is_active:
        return Response(
            {'detail': 'This account is inactive.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    token, _ = Token.objects.get_or_create(user=user)
    return Response({
        'token':   token.key,
        'display': user.get_full_name() or user.username,
        'message': 'Login successful!',
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    try:
        request.user.auth_token.delete()
    except Exception:
        pass
    return Response({'message': 'Logged out successfully.'})


# ─────────────────────────────────────────────────────────────────────────────
# FORGOT PASSWORD  (Email → OTP → Reset)
# Uses the PasswordResetOTP model — no external cache dependency.
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([AllowAny])
def forgot_password(request):
    """
    Step 1 — generate a 6-digit OTP, save it to DB, and email it.
    Request body:  { "email": "user@example.com" }
    """
    email = request.data.get('email', '').strip()
    if not email:
        return Response(
            {'message': 'Email is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        # Return 404 so the frontend can show "not found" instead of a generic error
        return Response(
            {'message': 'No account is registered with that email address.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Generate OTP and (over)write the DB record
    otp_code = str(random.randint(100000, 999999))
    PasswordResetOTP.objects.update_or_create(
        user=user,
        defaults={'otp': otp_code, 'created_at': timezone.now()},
    )

    # Send email
    send_mail(
        subject='FIRS — Your Password Reset Code',
        message=(
            f'Hi {user.username},\n\n'
            f'Your one-time password reset code is:\n\n'
            f'    {otp_code}\n\n'
            f'This code expires in 2 minutes.\n\n'
            f'If you did not request a password reset, please ignore this email.\n\n'
            f'— BFP Cagayan de Oro FIRS'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
    )

    return Response({'message': 'OTP sent to your email.'}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([AllowAny])
def verify_otp(request):
    """
    Step 2 — verify the 6-digit OTP.
    Request body:  { "email": "...", "otp": "123456" }
    """
    email     = request.data.get('email', '').strip()
    otp_input = request.data.get('otp', '').strip()

    if not email or not otp_input:
        return Response(
            {'message': 'Email and OTP are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return Response(
            {'message': 'No account found with that email.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    try:
        otp_record = PasswordResetOTP.objects.get(user=user)
    except PasswordResetOTP.DoesNotExist:
        return Response(
            {'message': 'No OTP was requested for this account. Please start over.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Check expiry (PASSWORD_RESET_TIMEOUT seconds, default 120 = 2 min)
    timeout_seconds = getattr(settings, 'PASSWORD_RESET_TIMEOUT', 120)
    age = (timezone.now() - otp_record.created_at).total_seconds()
    if age > timeout_seconds:
        otp_record.delete()
        return Response(
            {'message': 'OTP has expired. Please request a new one.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if otp_input != otp_record.otp:
        return Response(
            {'message': 'Invalid OTP. Please check the code and try again.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # OTP is valid — leave the record in DB so reset_password can re-verify
    return Response({'message': 'OTP verified.'}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([AllowAny])
def reset_password(request):
    """
    Step 3 — set the new password.
    Request body:  { "email": "...", "otp": "123456",
                     "new_password": "...", "confirm_password": "..." }
    """
    email            = request.data.get('email', '').strip()
    otp_input        = request.data.get('otp', '').strip()
    new_password     = request.data.get('new_password', '')
    confirm_password = request.data.get('confirm_password', '')

    # ── Basic validation ──────────────────────────────────────────────────────
    if not all([email, otp_input, new_password, confirm_password]):
        return Response(
            {'message': 'All fields are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if new_password != confirm_password:
        return Response(
            {'message': 'Passwords do not match.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(new_password) < 8:
        return Response(
            {'message': 'Password must be at least 8 characters.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # ── Verify user + OTP (security re-check) ────────────────────────────────
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return Response(
            {'message': 'No account found with that email.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    try:
        otp_record = PasswordResetOTP.objects.get(user=user)
    except PasswordResetOTP.DoesNotExist:
        return Response(
            {'message': 'No OTP was requested. Please start over.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    timeout_seconds = getattr(settings, 'PASSWORD_RESET_TIMEOUT', 120)
    age = (timezone.now() - otp_record.created_at).total_seconds()
    if age > timeout_seconds:
        otp_record.delete()
        return Response(
            {'message': 'OTP has expired. Please request a new one.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if otp_input != otp_record.otp:
        return Response(
            {'message': 'Invalid OTP.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # ── All good — update the password ───────────────────────────────────────
    user.set_password(new_password)
    user.save()
    otp_record.delete()   # invalidate OTP so it can't be reused

    return Response(
        {'message': 'Password reset successful. You can now log in.'},
        status=status.HTTP_200_OK,
    )


# ─────────────────────────────────────────────────────────────────────────────
# INCIDENTS
# ─────────────────────────────────────────────────────────────────────────────

class IncidentViewSet(viewsets.ModelViewSet):
    queryset         = Incident.objects.all()
    serializer_class = IncidentSerializer

    def get_queryset(self):
        return Incident.objects.all().order_by('created_at')


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def bulk_import(request):
    records = request.data.get('records', [])
    created  = 0
    failures = []

    for idx, rec in enumerate(records):
        serializer = IncidentSerializer(data={
            'dt':      rec.get('dt', ''),
            'loc':     rec.get('loc', ''),
            'inv':     rec.get('inv', ''),
            'occ':     rec.get('occ', ''),
            'dmg_raw': rec.get('dmgRaw') or rec.get('dmg_raw', 0),
            'alarm':   rec.get('alarm', ''),
            'sta':     rec.get('sta', ''),
            'eng':     rec.get('eng', ''),
            'by_user': rec.get('by') or rec.get('by_user', ''),
            'inj_c':   rec.get('injC') or rec.get('inj_c', 0),
            'inj_b':   rec.get('injB') or rec.get('inj_b', 0),
            'cas_c':   rec.get('casC') or rec.get('cas_c', 0),
            'cas_b':   rec.get('casB') or rec.get('cas_b', 0),
            'rem':     rec.get('rem', ''),
        })
        if serializer.is_valid():
            serializer.save()
            created += 1
        else:
            failures.append({'row': idx + 1, 'errors': serializer.errors})

    response_data = {'imported': created, 'failed': len(failures)}
    if failures:
        response_data['failures'] = failures[:20]

    return Response(
        response_data,
        status=status.HTTP_201_CREATED if created else status.HTTP_400_BAD_REQUEST,
    )
