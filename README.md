# Clinic Booking API (TypeScript, NestJS, PostgreSQL)

Built to the Koya Cohort 4 contract. A booking API plus a small web page where patients see free slots, book one and get a confirmation.

- All errors look like `{"error": "<message>"}`.
- All API routes need the header `X-API-Key` (401 otherwise).
- The web page is served from the same server at `/`.

**Pick your path**
- [Run it on your own computer (offline)](#a-run-it-locally-offline)
- [Run it online on Render](#b-deploy-online-on-render)
- [Test it](#c-test-it)
- [Something broke?](#troubleshooting)

---

## A. Run it locally (offline)

### What you need
- Node.js 20 or newer (`node -v`)
- PostgreSQL 14 or newer, **or** Docker
- Windows users: use WSL (Ubuntu). Everything below works the same there.

### Step 1: get the code
```
git clone <your-repo-url>
cd clinic-booking-api
npm install
```

### Step 2: set up PostgreSQL (choose ONE)

The app connects with its own role (`clinic_user`) to its own database (`koyaclinic`). Do not use your personal username or the `postgres` superuser in the app.

> **Why a new role?** Postgres users ("roles") live inside Postgres and are separate from your computer login. After install only the `postgres` role exists, so commands like `createdb` fail with `role "yourname" does not exist`. We create one role for the app instead.

**Option 1: Postgres installed on Linux or WSL**
1. Make sure it is running: `sudo service postgresql start`
2. Create the role and database (safe to rerun):
   ```
   sudo -u postgres psql -f scripts/setup-db.sql
   ```

**Option 2: Postgres installed on macOS (Homebrew)**
```
brew install postgresql@16
brew services start postgresql@16
psql postgres -f scripts/setup-db.sql
```

**Option 3: Postgres installed on native Windows**
Open "SQL Shell (psql)" or a terminal, then run (enter the password you chose at install):
```
psql -U postgres -f scripts/setup-db.sql
```

**Option 4: Docker (no Postgres install needed)**
```
docker run --name clinic-pg -e POSTGRES_USER=clinic_user -e POSTGRES_PASSWORD=clinic_pass -e POSTGRES_DB=koyaclinic -p 5432:5432 -d postgres:16
```
- Start it again later with `docker start clinic-pg`.
- If port 5432 is already used by an installed Postgres, use `-p 5433:5432` and put `5433` in `DATABASE_URL`.
- On WSL, turn on Docker Desktop > Settings > Resources > WSL Integration for your distro.

**Check the database works** (use the port you chose):
```
psql "postgres://clinic_user:clinic_pass@localhost:5432/koyaclinic" -c "select 1"
```
You should see a `1`. If you do, Postgres is ready.

### Step 3: configure the app
```
cp .env.example .env
```
On Windows PowerShell use `copy .env.example .env`. Then open `.env` and set:

| Variable | Meaning | Local value |
|---|---|---|
| `API_KEY` | The secret every request must send | any long random string |
| `DATABASE_URL` | How the app reaches Postgres | `postgres://clinic_user:clinic_pass@localhost:5432/koyaclinic` |
| `PGSSL` | Use SSL to the database | `false` |
| `PORT` | Port for the app | `3000` |
| `SEED_DEMO_DATA` | Fill an empty database with sample slots | `false` |

The app reads `.env` automatically. No `export` needed.

### Step 4: start it
```
npm run dev
```
Wait for `API listening`, then open http://localhost:3000. Tables are created automatically on first start.

### Step 5: add your own data
The database starts empty. Add slots in either way:
- **Web page:** paste your API key, open "Set up your data", enter a provider, a start time, minutes per slot and how many, then "Add slots".
- **API:** `POST /slots` (see [Endpoints](#endpoints)).

Set `SEED_DEMO_DATA=true` only if you want sample slots on an empty database.

---

## B. Deploy online on Render

You need a GitHub account and a Render account (render.com).

1. **Push the code to GitHub** (`.env` is git-ignored, so your secrets stay local).
2. **Create the database:** Render > New + > PostgreSQL. Name it `clinic-db`, choose the Free plan and the nearest region, then Create Database. When it says **Available**, open it and copy the **Internal Database URL**.
3. **Create the web service:** New + > Web Service > pick your repo, then set:
   - Language: Node
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Health check path (Advanced): `/health`
4. **Environment variables:**

   | Variable | Value |
   |---|---|
   | `API_KEY` | a new long random string (not your local one) |
   | `DATABASE_URL` | the **Internal** Database URL |
   | `PGSSL` | `false` (use `true` only with the External URL) |
   | `SEED_DEMO_DATA` | `false` |

5. **Create Web Service** and watch the Logs until you see `API listening` and the status is **Live**.
6. **Verify:** open `https://<your-app>.onrender.com/health` (expect `{"status":"ok"}`), then open `https://<your-app>.onrender.com/`.
7. Share the base URL and the API key with whoever needs them.

**Shortcut:** `render.yaml` in this repo can create the database and the service together (New + > Blueprint).

**Good to know**
- The free web service sleeps when idle. The first request after a pause can take about a minute, so open it before a demo.
- The data lives in Postgres, so restarts and redeploys do not lose bookings.
- Vercel is not recommended here: this is a long-running NestJS server and Vercel would need it converted to serverless functions plus a hosted database.

---

## C. Test it

Works the same against `http://localhost:3000` and your Render URL.

1. **Web page:** open the URL, paste the API key, add slots, book one, look it up, cancel it.
2. **`requests.http`:** install the VS Code extension **REST Client** (`humao.rest-client`). Set `@baseUrl` at the top to your local or Render URL and make sure `API_KEY` is in `.env` (or replace `@apiKey` with the key). Run the sections in order.
3. **Race test (Level 3):** 10 simultaneous bookings for one slot, expect one `201` and nine `409`:
   ```
   API_KEY=your-key BASE_URL=http://localhost:3000 npm run race
   ```
   PowerShell: `$env:API_KEY="your-key"; npm run race`
4. **Team test:** follow `TEAM_TEST_CHECKLIST.md`.

Everyone using the same server shares one database. Use your own email when booking, and avoid "Delete everything" or `POST /reset` while others are testing.

---

## Using your own data
- **Web page:** "Set up your data".
- **`POST /slots`:** adds slots and keeps existing bookings.
- **`POST /reset`:** replaces ALL slots and deletes ALL bookings. Use it to start clean, not during a live demo.

---

## Endpoints
| Method | Path | Request | Success | Level |
|---|---|---|---|---|
| POST | /reset | `{"slots":[{"id","provider","start","end"}]}` | 200 | 1 |
| POST | /slots (extra, not in contract) | `{"slots":[{"provider","start","end"}]}`, `id` optional | 201, adds slots, keeps bookings | setup |
| GET | /slots (`?provider=`) | none | 200 `{"slots":[{id,provider,start,end,available}]}` earliest start first | 1 |
| POST | /bookings | `{"slot_id","name","email"}` + optional `Idempotency-Key` header | 201 booking | 1-5 |
| GET | /bookings?email=&limit=&cursor= | none | 200 `{"bookings":[...],"next_cursor":string\|null}` oldest first | 4 |
| GET | /bookings/:id | none | 200 booking, 404 | 1 |
| DELETE | /bookings/:id | none | 200 booking with `status:"cancelled"`, 404, 409 if already cancelled | 3 |
| GET | /health | none (no key) | 200 `{"status":"ok"}` | - |

Booking = `{id, slot_id, name, email, status, created_at}`.

POST /bookings status codes:
- 400: missing, empty or invalid field, or the slot has already started
- 404: slot not found
- 409: slot already booked
- 422: `Idempotency-Key` reused with a different body
- 429 + `Retry-After` (seconds): the 6th attempt for one email within a minute. Failed attempts count.

Not shown in the contract, so assumed: the body returned by `/reset` (it returns the slots) and the text of the 401 message.

---

## Project structure (NestJS)
```
src/
  main.ts                  bootstrap: loads .env, JSON body limit, static web page, listen
  app.module.ts            root module, registers the global error filter
  db/                      DbModule + DbService: the single pg Pool, creates tables on startup
  common/
    api-key.guard.ts       Level 2: X-API-Key check (guard)
    error.filter.ts        turns every error into {"error": "..."}
    api-error.ts           HttpException that can carry headers (Retry-After)
  slots/                   controller + service: POST /reset, POST /slots, GET /slots
  bookings/                controller + service: create, list, get, cancel (Levels 1-5)
  health/                  GET /health
public/index.html          the web page
scripts/setup-db.sql       one-time local role and database setup
scripts/race-test.mjs      concurrency test
requests.http              REST Client requests
```
Controllers only handle HTTP; services hold the logic and talk to Postgres.

---

## Troubleshooting

| Error | Meaning | Fix |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | Postgres is not running, or is on another port | Start it (`sudo service postgresql start`, `brew services start postgresql@16`, or `docker start clinic-pg`). Check the port in `DATABASE_URL`. |
| `role "yourname" does not exist` | You ran `createdb` as your own login | Do not use `createdb`. Run `scripts/setup-db.sql` as in Step 2. |
| `password authentication failed for user ...` | Wrong user or password in `DATABASE_URL`, or you are reaching a different Postgres than you think | Rerun `scripts/setup-db.sql` (it resets the password) and copy the URL from `.env.example`. Check what owns the port: `sudo ss -ltnp \| grep 5432`. |
| `database "koyaclinic" already exists` | Harmless. It was created earlier, maybe by another role | Rerun `scripts/setup-db.sql`; it hands the database to `clinic_user`. |
| `EADDRINUSE :::3000` | An old copy of the app is still running | `lsof -i :3000` then `kill <PID>`, or set another `PORT` in `.env`. |
| `API_KEY env var is required` | `.env` is missing or has no `API_KEY` | Create `.env` from `.env.example` in the project root. |
| SSL or `no pg_hba.conf entry` on Render | Wrong URL type for the `PGSSL` setting | Internal URL with `PGSSL=false`, or External URL with `PGSSL=true`. |
| 401 on every request | Missing or wrong `X-API-Key` | Send the same value as `API_KEY` on that server (local and Render keys differ). |
| 429 when testing | More than 5 booking attempts for one email in a minute | Wait for the `Retry-After` seconds, or use another email. |
| Render page takes a minute to load | Free instance was asleep | Wait, then refresh. Open it before a demo. |
