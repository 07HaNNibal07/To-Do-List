import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import sessionmaker

from app.db import create_sqlite_engine, initialize_database
from app.routes import router
from app.sessions import AnonymousSessionMiddleware

APP_DIR = Path(__file__).resolve().parent
DEFAULT_DB_PATH = APP_DIR.parent / "data" / "tasks.sqlite3"


def create_app(db_path: Path | None = None) -> FastAPI:
    database = Path(db_path or os.environ.get("CRIMSON_DB_PATH") or DEFAULT_DB_PATH).resolve()
    engine = create_sqlite_engine(database)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        database.parent.mkdir(parents=True, exist_ok=True)
        try:
            initialize_database(engine)
            yield
        finally:
            engine.dispose()

    application = FastAPI(title="Crimson Tasks", lifespan=lifespan)
    application.state.session_factory = sessionmaker(engine, expire_on_commit=False)
    application.add_middleware(
        AnonymousSessionMiddleware, session_factory=application.state.session_factory,
    )
    application.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")
    application.include_router(router)
    return application


app = create_app()
