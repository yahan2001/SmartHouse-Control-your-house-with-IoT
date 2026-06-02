from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv
import os

load_dotenv()

DB_HOST = os.getenv("DB_HOST")
print("DB_HOST:", DB_HOST)  # Debug: Kiểm tra giá trị DB_HOST # Debug: Kiểm tra giá trị DB_USER
DB_PORT = os.getenv("DB_PORT")
DB_USER = os.getenv("DB_USER")
print("DB_USER:", DB_USER)  # Debug: Kiểm tra giá trị DB_USER
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_NAME = os.getenv("DB_NAME")
print("DB_NAME:", DB_NAME)  # Debug: Kiểm tra giá trị DB_NAME

DATABASE_URL = (
    f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}"
    f"@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()

def get_db():

    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()