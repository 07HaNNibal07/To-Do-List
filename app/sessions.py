import hashlib
import re
import secrets
from datetime import timedelta

from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware

from app.db import AnonymousSession, utc_now

COOKIE_NAME = "crimson_session"
SESSION_SECONDS = 30 * 24 * 60 * 60
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}")


def resolve_session(session_factory, token):
    now = utc_now()
    with session_factory() as database:
        if token and TOKEN_PATTERN.fullmatch(token):
            token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
            existing = database.get(AnonymousSession, token_hash)
            if existing is not None and existing.expires_at > now:
                return token_hash, None

        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
        database.add(AnonymousSession(
            token_hash=token_hash,
            expires_at=now + timedelta(seconds=SESSION_SECONDS),
        ))
        database.commit()
        return token_hash, token


class AnonymousSessionMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, session_factory):
        super().__init__(app)
        self.session_factory = session_factory

    async def dispatch(self, request, call_next):
        if request.url.path != "/" and not request.url.path.startswith("/api/"):
            return await call_next(request)

        owner, token = await run_in_threadpool(
            resolve_session, self.session_factory, request.cookies.get(COOKIE_NAME),
        )
        request.state.owner_id = owner
        response = await call_next(request)
        response.headers["Cache-Control"] = "private, no-store"
        response.headers.append("Vary", "Cookie")
        if token is not None:
            response.set_cookie(
                COOKIE_NAME,
                token,
                max_age=SESSION_SECONDS,
                httponly=True,
                secure=request.url.scheme == "https",
                samesite="lax",
                path="/",
            )
        return response
