# Running openGym on Netlify (serverless, MongoDB)

No server of your own: the frontend is static files, the API runs as a Netlify Function, and the
data is in MongoDB (Atlas free tier is enough). It is the same `api/server.js` that runs in Docker,
started with `SERVERLESS=1`.

## How it differs from the Docker setup

Nothing is remembered in memory between requests, because there may be several instances, or none
running. So in this mode:

- every request loads the documents it needs from MongoDB, and saves are conditional: when two
  instances save the same profile at the same moment, one wins and the other gets a `503` that the
  app retries;
- sign-in challenges, device-pairing codes and pending rest-timer alerts live in one MongoDB
  document (`eph`) instead of in memory;
- the timers become a scheduled function, `api/netlify/functions/tick.mjs`, that calls
  `POST /api/internal/tick` every minute (daily reminders, missed-workout nudges, rest-timer alerts).

## Limits of this mode

- **Rest-timer alerts arrive up to a minute late** (they wait for the next tick). The in-app timer is
  unaffected.
- **No photo/video uploads** (`MEDIA_UPLOADS=off`): a function has no disk. Exercise images and
  animations come from the jsDelivr CDN, set in `netlify.toml`.
- **The AI Coach is off** (it needs a long-running process).
- Sign-in rate limiting and the live "who is training now" view are per instance, so they are
  weaker than on a single server.
- Netlify's own limits apply (request size, execution time, free-plan quotas, how often scheduled
  functions may run). Check their current docs: they are not covered here.
- Cold starts add a moment to the first request after a quiet period.

## Setup

1. **MongoDB:** create a free cluster on MongoDB Atlas, a database user, and allow network access
   from anywhere (`0.0.0.0/0`; Netlify has no fixed addresses). Copy the connection string.
2. **Netlify:** new site from your fork of the repo. `netlify.toml` already holds the build.
3. **Environment variables** (Site configuration → Environment variables):

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | the Atlas connection string |
   | `MONGODB_DB` | optional, default `opengym` |
   | `ORIGIN` | the site's address, e.g. `https://gym.example.com` (no trailing slash) |
   | `RP_ID` | its hostname, e.g. `gym.example.com`. Passkeys are tied to it: set it once and keep it |
   | `CRON_SECRET` | a random string of 16+ characters (`openssl rand -hex 16`) |

   Optional, as in `docs/SELF_HOSTING.md`: `PASSWORD_LOGIN`, `SESSION_DAYS`, `INVITE_ONLY`,
   `ADMIN_UIDS`, `FIRST_USER_ADMIN`.
4. Deploy, open the site, create your profile. Use a custom domain if you want a stable `RP_ID`
   (a `*.netlify.app` name works too, as long as you never rename the site).

## Moving data from a Docker install

Start the Docker stack once with `MONGODB_URI` pointing at the same Atlas database
(`docker-compose.mongo.yml`): its first start imports `./data` into MongoDB. Then deploy to Netlify
against that database.

## Tests

`MONGODB_TEST_URI=mongodb://localhost:27017 npm test` in `api/` also runs
`test/server-mongo.test.js` and `test/server-serverless.test.js` (two instances, one database).
