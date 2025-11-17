import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from jose import JWTError, jwt

# ---- Config from environment ----
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "CHANGE_ME")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30"))


def create_access_token(
    subject: Any,
    expires_minutes: Optional[int] = None,
    extra_claims: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Create a signed JWT.
    - subject: str or dict. If str, placed in 'sub'.
    - expires_minutes: override default expiry.
    - extra_claims: merged into payload.
    """
    now = datetime.now(timezone.utc)
    exp_minutes = expires_minutes or ACCESS_TOKEN_EXPIRE_MINUTES
    expire = now + timedelta(minutes=exp_minutes)

    payload: Dict[str, Any] = {}
    if isinstance(subject, dict):
        payload.update(subject)
    else:
        payload["sub"] = str(subject)

    if extra_claims:
        payload.update(extra_claims)

    # Standard claims
    payload.update(
        {
            "iat": int(now.timestamp()),
            "nbf": int(now.timestamp()),
            "exp": int(expire.timestamp()),
        }
    )

    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Dict[str, Any]:
    """
    Decode a JWT and return its payload.
    Raises jose.JWTError on failure.
    """
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


def verify_token(token: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    """
    Verify a JWT. Returns (ok, payload, error_message).
    """
    try:
        payload = decode_token(token)
        return True, payload, None
    except JWTError as e:
        return False, None, str(e)

