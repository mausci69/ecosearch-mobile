"""initial schema

Revision ID: 0001_init
Revises:
Create Date: 2025-09-16 00:00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("email", sa.String, nullable=False, unique=True, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=text("NOW()")),
    )

    op.create_table(
        "api_keys",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("provider", sa.String, server_default="openai"),
        sa.Column("enc_key", sa.String, nullable=False),
        sa.Column("active", sa.Boolean, server_default=sa.text("TRUE")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=text("NOW()")),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "uploads",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("filename", sa.String, nullable=False),
        sa.Column("mime", sa.String),
        sa.Column("size", sa.Integer),
        sa.Column("storage_url", sa.String),
        sa.Column("status", sa.String, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=text("NOW()")),
    )

    op.create_table(
        "jobs",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("upload_id", sa.Integer, sa.ForeignKey("uploads.id")),
        sa.Column("type", sa.String, nullable=False),
        sa.Column("status", sa.String, server_default="queued"),
        sa.Column("params_json", sa.JSON),
        sa.Column("result_url", sa.String),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "usage",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("job_id", sa.Integer, sa.ForeignKey("jobs.id")),
        sa.Column("tokens_in", sa.Integer),
        sa.Column("tokens_out", sa.Integer),
        sa.Column("seconds_cpu", sa.Integer),
        sa.Column("cost_estimate", sa.Integer),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=text("NOW()")),
    )


def downgrade() -> None:
    op.drop_table("usage")
    op.drop_table("jobs")
    op.drop_table("uploads")
    op.drop_table("api_keys")
    op.drop_table("users")

