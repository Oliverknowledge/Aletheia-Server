# Imposter Protocol Backend

Lightweight Express backend powering the Aletheia/Luffa Imposter Protocol game loop.

## Endpoints

### Health Check

`GET /health`

Returns:

```json
{ "ok": true }
```

### Create Run

`POST /api/runs`

Returns the round data used by the frontend and bot.

---

## Running Locally

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

Add your OpenAI API key to `.env`.

Start the server:

```bash
npm start
```

By default the server runs on:

```txt
process.env.PORT || 3000
```

---

## Deploying on Render

1. Push this backend directory to a Git repository.
2. In Render, create a new **Web Service** and connect the repo.
3. Use these settings:

   * Runtime: `Node`
   * Build Command: `npm install`
   * Start Command: `npm start`
4. Add environment variables:

   * `OPENAI_API_KEY`
   * `OPENAI_MODEL` *(optional — defaults to `gpt-4.1-mini`)*
   * `OPENAI_BASE_URL` *(optional — defaults to `https://api.openai.com/v1`)*
5. Leave `PORT` unset unless you have a reason to override it — Render handles it automatically.

Deploy and verify with:

```txt
GET https://<your-render-service>.onrender.com/health
```

Expected response:

```json
{ "ok": true }
```

---

## Notes

* CORS is enabled.
* Data is stored in memory only (no database).
* Existing API responses and behaviour remain unchanged.
