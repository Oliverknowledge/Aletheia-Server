# Imposter Protocol Backend

Minimal Express backend for the Aletheia/Luffa Imposter Protocol game loop.

## API Routes

- `GET /health` -> `{ "ok": true }`
- `POST /api/runs` -> returns round payload used by the bot/frontend

## Local Run

1. Install dependencies:
   - `npm install`
2. Create env file:
   - `cp .env.example .env`
3. Set your OpenAI key in `.env`.
4. Start server:
   - `npm start`

Server listens on:
- `process.env.PORT || 3000`

## Deploy To Render (Free Web Service)

1. Push this backend folder to a Git repository.
2. In Render, create a new **Web Service** and connect your repository.
3. Configure:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add environment variables in Render:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` (optional, default is `gpt-4.1-mini`)
   - `OPENAI_BASE_URL` (optional, default is `https://api.openai.com/v1`)
5. Do not set `PORT` manually on Render unless needed; Render injects it automatically.
6. Deploy.

After deploy, verify:
- `GET https://<your-render-service>.onrender.com/health`

Expected response:
- `{ "ok": true }`

## Notes

- CORS is enabled.
- Storage is in-memory (no database).
- API behavior and response shape are unchanged.
