-- One-time local database setup. Safe to run more than once.
-- Creates a dedicated role for the app and a database it owns.
-- Change the password here AND in DATABASE_URL if you want something else.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clinic_user') THEN
    CREATE ROLE clinic_user WITH LOGIN PASSWORD 'clinic_pass';
  END IF;
END
$$;

ALTER ROLE clinic_user WITH LOGIN PASSWORD 'clinic_pass';

SELECT 'CREATE DATABASE koyaclinic OWNER clinic_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'koyaclinic')
\gexec

ALTER DATABASE koyaclinic OWNER TO clinic_user;
