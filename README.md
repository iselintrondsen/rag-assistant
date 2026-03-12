# IS-217 Universellutforming – Fagassistent

En RAG-basert (Retrieval-Augmented Generation) fagassistent bygd med Node.js, Express, PostgreSQL og pgvector. Laget for emnet IS-217 Universellutforming, men kan brukes til ethvert fag.

Last opp PDF-, DOCX-, TXT- og MD-filer og still spørsmål om innholdet. Appen henter de mest relevante tekstbitene og genererer svar basert på dine egne dokumenter.

---

## Hurtigstart

### Railway (anbefalt for deling)

1. Push repoet til GitHub.
2. I Railway: **New Project → Deploy from GitHub repo**.
3. Legg til database: **New → Database → PostgreSQL**.
4. Railway setter `DATABASE_URL` automatisk når Postgres er koblet til servicen.
5. Legg til miljøvariabler i app-servicen (se [Konfigurasjon](#konfigurasjon)):
   - `OPENAI_API_KEY` (påkrevd)
   - `ACCESS_PASSWORD` og `ADMIN_PASSWORD` (anbefalt)
6. Kjør databaseskjema én gang:
   ```bash
   psql "$DATABASE_URL" -f src/db/schema.sql
   ```

Railway håndterer HTTPS og domene automatisk. Repoet inkluderer `railway.json` med build- og deploy-konfig.

---

### Docker (lokal utvikling)

Krever kun [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
cp .env.example .env
# Fyll inn OPENAI_API_KEY (og evt. ACCESS_PASSWORD) i .env
docker compose up
```

Appen kjører på **http://localhost:3000**. PostgreSQL med pgvector startes automatisk.

---

### Manuell installasjon

**Krav:** Node.js ≥ 18, PostgreSQL ≥ 15 med pgvector.

```bash
# Installer pgvector
brew install pgvector          # macOS
sudo apt install postgresql-16-pgvector   # Ubuntu/Debian

# Sett opp prosjektet
npm install
cp .env.example .env
# Rediger .env

# Opprett database og kjør skjema
psql -U postgres -c "CREATE DATABASE rag_assistant;"
psql -U postgres -d rag_assistant -f src/db/schema.sql

# Start appen
npm run dev     # Utvikling (auto-restart)
npm start       # Produksjon
npm test        # Kjør tester
```

---

## Konfigurasjon

| Variabel            | Påkrevd | Beskrivelse                                                       |
|---------------------|---------|-------------------------------------------------------------------|
| `OPENAI_API_KEY`    | ✅      | OpenAI-nøkkel (`sk-...`)                                          |
| `DATABASE_URL`      | ✅*     | Full connection string – settes automatisk av Railway             |
| `DB_HOST`           | ✅*     | PostgreSQL-host (alternativ til `DATABASE_URL`)                   |
| `DB_NAME`           | ✅*     | Databasenavn                                                      |
| `DB_USER`           | ✅*     | Databasebruker                                                    |
| `DB_PASSWORD`       |         | Databasepassord                                                   |
| `DB_PORT`           |         | PostgreSQL-port (standard: `5432`)                                |
| `DB_SSL`            |         | Sett til `true` for SSL-tilkobling (kreves på Railway)            |
| `ACCESS_PASSWORD`   |         | Passord for vanlige brukere – tomt = ingen autentisering          |
| `ADMIN_PASSWORD`    |         | Passord for admin (opplasting, sletting, dokumentliste)           |
| `SENTRY_DSN`        |         | Sentry-DSN for feilsporing – tomt = deaktivert                    |

`✅*` — sett enten `DATABASE_URL` **eller** `DB_HOST` + `DB_NAME` + `DB_USER`. Railway sine `PGHOST`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`/`PGPORT`-variabler støttes også.

Appen stopper ved oppstart dersom `OPENAI_API_KEY` mangler eller ingen gyldig DB-konfigurasjon er satt.

---

## Autentisering

Appen har to tilgangsnivåer:

| Rolle       | Variabel          | Tilgang                                          |
|-------------|-------------------|--------------------------------------------------|
| Bruker      | `ACCESS_PASSWORD` | Lese og chatte                                   |
| Admin       | `ADMIN_PASSWORD`  | Alt over + laste opp, slette og liste dokumenter |

Admin-innlogging nås via `/admin/login`. Ved admin-innlogging settes to cookies – admin beholder også bruker-tilgang. Begge passordene er valgfrie; uten passord er appen åpen for alle.

---

## Bruk

### Laste opp dokumenter (krever admin)

1. Logg inn som admin på `/admin/login`.
2. Klikk **Velg fil(er)** i sidepanelet – opptil 50 filer samtidig (PDF, DOCX, TXT, MD).
3. Klikk **Last opp og prosesser** (~10–60 sek avhengig av filstørrelse).
4. Klikk ✦-ikonet ved et dokument for raskt AI-sammendrag.
5. Re-upload et dokument via `PUT /api/upload/:id` for å erstatte det med en ny versjon.

### Stille spørsmål

1. Skriv spørsmålet i chat-feltet og trykk **Enter** (eller klikk et forslagskort).
2. Appen bruker HyDE og multi-query for å finne de mest relevante tekstbitene.
3. GPT genererer et streamet svar i sanntid.
4. Klikk **Kilder** under svaret for å se hvilke tekstbiter som ble brukt.
5. Klikk 📋-ikonet for å kopiere svaret.
6. Forslag til oppfølgingsspørsmål vises etter hvert svar.

### Samtalehistorikk

Samtalen bevares i `localStorage` og gjenopprettes automatisk ved sideopplasting. Klikk **Tøm samtale** i bunnteksten for å starte på nytt.

### Gruppe-isolasjon (valgfritt)

For å isolere dokumenter per gruppe, kjør migrasjonsfilen og send `group`-feltet i API-kall:

```bash
psql -U postgres -d rag_assistant -f src/db/migration_groups.sql
```

```json
{ "message": "Hva er WCAG?", "group": "gruppe-a" }
```

---

## API-referanse

| Metode   | Endpoint                   | Auth    | Beskrivelse                                    |
|----------|----------------------------|---------|------------------------------------------------|
| `POST`   | `/api/upload`              | Admin   | Last opp og prosesser én eller flere filer     |
| `PUT`    | `/api/upload/:id`          | Admin   | Erstatt et eksisterende dokument               |
| `GET`    | `/api/documents`           | Admin   | Hent liste over alle dokumenter                |
| `DELETE` | `/api/documents/:id`       | Admin   | Slett dokument og tilhørende chunks            |
| `POST`   | `/api/chat`                | Bruker  | SSE-stream: send spørsmål, motta streamet svar |
| `POST`   | `/api/auth/login`          | —       | Logg inn som bruker (setter cookie)            |
| `POST`   | `/api/auth/admin-login`    | —       | Logg inn som admin (setter to cookies)         |
| `GET`    | `/api/auth/logout`         | —       | Logg ut fullstendig                            |
| `GET`    | `/api/auth/admin-logout`   | —       | Avslutt admin-økt (beholder bruker-cookie)     |

### POST /api/chat

**Request body:**
```json
{
  "message": "Hva er WCAG 2.1 AA?",
  "history": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }],
  "group": "gruppe-a"
}
```

`history` og `group` er valgfrie.

**SSE-hendelser:**

| Hendelse      | Innhold                                                     | Beskrivelse              |
|---------------|-------------------------------------------------------------|--------------------------|
| `status`      | `{ status: 'preparing' \| 'searching' \| 'generating' }`   | Fremdriftsindikator      |
| `delta`       | `{ delta: "..." }`                                          | Tekstfragment fra GPT    |
| `done`        | `{ done: true, sources: [...] }`                            | Svar ferdig + kildeliste |
| `suggestions` | `{ suggestions: ["?", "?", "?"] }`                          | Oppfølgingsspørsmål      |
| `error`       | `{ error: "..." }`                                          | Feilmelding              |

### Rate limiting

| Endepunkt     | Grense                   |
|---------------|--------------------------|
| `/api/chat`   | 40 forespørsler / 10 min |
| `/api/upload` | 20 opplastinger / time   |

---

## Arkitektur

```
Bruker
  │
  │ POST /api/chat  /  POST /api/upload
  ▼
┌──────────────────────────────────────────────────────────────────┐
│  Express (src/app.js)                                            │
│  ├── cookie-parser + auth (bruker / admin to-nivå)               │
│  ├── express-rate-limit (chat: 40/10min, upload: 20/time)        │
│  ├── sanitize-middleware (HTML-escaping, størrelsesvalidering)   │
│  └── Winston-logging (dev: terminal, prod: logs/ med rotasjon)   │
│                                                                  │
│  routes/upload.js ──► parser.js                                  │
│                   ──► chunker.js  (semantisk, 1200/200)          │
│                   ──► embeddings.js ──► OpenAI                   │
│                   ──► PostgreSQL (chunks + group_id)             │
│                                                                  │
│  routes/chat.js   ──► prepareRetrieval() [HyDE + varianter]     │
│                   ──► retrieveWithMultipleQueries() [pgvec]      │
│                   ──► getHistorySummary() (>8 meldinger)         │
│                   ──► OpenAI Chat (stream) ──► SSE               │
│                   ──► generateSuggestions() [oppfølging]         │
│                                                                  │
│  routes/documents.js ──► PostgreSQL                              │
└──────────────────────────────────────────────────────────────────┘
  │
  │ views/index.ejs + public/
  ▼
Nettleser (EJS-frontend med SSE, localStorage og marked.js)
```

### Mappestruktur

```
rag-assistant/
├── src/
│   ├── app.js                      # Express-entry-point, middleware, Sentry
│   ├── config/
│   │   ├── database.js             # pg.Pool-singleton (støtter Railway + Docker + lokal)
│   │   └── logger.js               # Winston-logger med daglig rotasjon
│   ├── db/
│   │   ├── schema.sql              # Databaseskjema + pgvector-indeks
│   │   └── migration_groups.sql    # Valgfri gruppe-isolasjon (group_id)
│   ├── middleware/
│   │   ├── auth.js                 # To-nivå auth: bruker (ACCESS_PASSWORD) + admin (ADMIN_PASSWORD)
│   │   └── sanitize.js             # Input-sanitering og validering
│   ├── routes/
│   │   ├── upload.js               # POST /api/upload + PUT /api/upload/:id
│   │   ├── chat.js                 # POST /api/chat (SSE-stream)
│   │   └── documents.js            # GET/DELETE /api/documents
│   └── services/
│       ├── parser.js               # PDF / DOCX / TXT / MD → tekst
│       ├── chunker.js              # Semantisk chunking (overskrifter, 1200/200)
│       ├── embeddings.js           # Tekst → OpenAI-vektorer
│       └── retrieval.js            # Multi-query pgvector-søk med group_id-støtte
├── tests/
│   ├── sanitize.test.js            # 12 unit-tester for sanitering
│   └── chunker.test.js             # 7 unit-tester for chunking
├── views/
│   └── index.ejs                   # Hoved-HTML (EJS-mal)
├── public/
│   ├── css/style.css               # Stylesheet
│   └── js/chat.js                  # Frontend (SSE, localStorage, marked.js)
├── logs/                           # Winston-logger (produksjon, gitignored)
├── uploads/                        # Midlertidig fillagring (slettes etter prosessering)
├── Dockerfile                      # Container-image
├── docker-compose.yml              # Starter app + PostgreSQL lokalt
├── railway.json                    # Railway build/deploy-konfig
├── nginx.conf.example              # HTTPS-oppsett for selvhostet deploy
├── .env.example                    # Mal for miljøvariabler
└── package.json
```

---

<<<<<<< HEAD
## Teknologivalg
=======
## Forutsetninger

- **Node.js** ≥ 18
- **PostgreSQL** ≥ 15 med **pgvector**-utvidelsen installert
- En **OpenAI API-nøkkel** med tilgang til `text-embedding-3-small` og `gpt-4o-mini`

### Alternativ: kjør alt med Docker

Det enkleste oppsettet. Krever kun [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
cp .env.example .env
# Rediger .env og fyll inn OPENAI_API_KEY og DB_PASSWORD
docker compose up
```

Appen er tilgjengelig på **http://localhost:3000**. PostgreSQL med pgvector startes automatisk.

### Manuell installasjon av pgvector

**macOS (Homebrew):**
```bash
brew install pgvector
```

**Ubuntu/Debian:**
```bash
sudo apt install postgresql-16-pgvector
```

---

## Oppsett og kjøring (uten Docker)

### 1. Installer avhengigheter

```bash
npm install
```

### 2. Konfigurer miljøvariabler

```bash
cp .env.example .env
```

Rediger `.env` og fyll inn:

| Variabel          | Påkrevd | Beskrivelse                                                                 |
|-------------------|---------|-----------------------------------------------------------------------------|
| `OPENAI_API_KEY`  | ✅      | Din OpenAI-nøkkel (`sk-...`)                                                |
| `DATABASE_URL`    | ✅*     | Full PostgreSQL connection string (typisk i Railway)                        |
| `DB_HOST`         | ✅*     | PostgreSQL-host (standard: `localhost`)                                     |
| `DB_NAME`         | ✅*     | Databasenavn (standard: `rag_assistant`)                                    |
| `DB_USER`         | ✅*     | Databasebruker                                                              |
| `DB_PORT`         |         | PostgreSQL-port (standard: `5432`)                                          |
| `DB_PASSWORD`     |         | Databasepassord                                                             |
| `CHAT_MODEL`      |         | GPT-modell (standard: `gpt-4o-mini`)                                        |
| `ACCESS_PASSWORD` |         | Passord for innlogging – tomt = ingen autentisering                         |
| `ADMIN_PASSWORD`  |         | Admin-passord for opplasting/sletting/listing av dokumenter                 |
| `SENTRY_DSN`      |         | Sentry-DSN for feilsporing – tomt = deaktivert                              |

`✅*` betyr at du må sette enten `DATABASE_URL`, eller `DB_HOST` + `DB_NAME` + `DB_USER` (evt. Railway sine `PGHOST`/`PGDATABASE`/`PGUSER`).

Applikasjonen stopper ved oppstart dersom `OPENAI_API_KEY` mangler, eller hvis ingen gyldig DB-konfigurasjon er satt.

### 3. Opprett databasen og kjør skjemaet

```bash
psql -U postgres -c "CREATE DATABASE rag_assistant;"
psql -U postgres -d rag_assistant -f src/db/schema.sql
```

### 4. Start applikasjonen

```bash
npm start          # Produksjon
npm run dev        # Utvikling (auto-restart med nodemon)
npm test           # Kjør alle tester
```

Applikasjonen kjører på **http://localhost:3000**

---

## Bruk

### Laste opp dokumenter

1. Gå til `http://localhost:3000`
2. Klikk «Velg fil(er)» i sidepanelet – du kan velge opptil **50 filer** samtidig (PDF, DOCX, TXT, MD)
3. Klikk «Last opp og prosesser»
4. Appen parser, chunker og lager embeddings automatisk (~10–60 sek avhengig av filstørrelse)
5. Klikk ✦-ikonet ved et dokument for å få et raskt AI-sammendrag
6. Klikk ✦ igjen (re-upload via `PUT /api/upload/:id`) for å erstatte et dokument med ny versjon

### Stille spørsmål

1. Skriv spørsmålet ditt i chat-feltet og trykk **Enter** (eller klikk et forslagskort)
2. Appen bruker HyDE og multi-query for å finne de mest relevante tekstbitene
3. GPT genererer et streamet svar i sanntid
4. Klikk «Kilder» under svaret for å se hvilke tekstbiter som ble brukt
5. Klikk 📋-ikonet for å kopiere svaret til utklippstavlen
6. Forslag til oppfølgingsspørsmål vises etter hvert svar

### Samtalehistorikk

Samtalen bevares i `localStorage` og gjenopprettes automatisk ved sideopplasting – også etter at du har lukket nettleserfanen. Klikk «Tøm samtale» i bunnteksten for å starte på nytt.


---

## API-referanse

| Metode   | Endpoint              | Beskrivelse                                       |
|----------|-----------------------|---------------------------------------------------|
| `POST`   | `/api/upload`         | Last opp og prosesser én eller flere filer        |
| `PUT`    | `/api/upload/:id`     | Erstatt et eksisterende dokument med ny versjon   |
| `GET`    | `/api/documents`      | Hent liste over alle dokumenter                   |
| `DELETE` | `/api/documents/:id`  | Slett et dokument og alle tilhørende chunks       |
| `POST`   | `/api/chat`           | SSE-stream: send spørsmål, motta streamet svar    |
| `POST`   | `/api/auth/login`     | Logg inn med passord (setter cookie)              |
| `GET`    | `/api/auth/logout`    | Logg ut (sletter cookie)                          |

### POST /api/chat – request body

```json
{
  "message": "Hva er WCAG 2.1 AA?",
  "history": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }],
  "group": "gruppe-a"
}
```

`history` og `group` er valgfrie. `group` filtrerer søket til kun dokumenter lastet opp med samme gruppe-ID.

### POST /api/chat – SSE-hendelser

| Hendelse      | Innhold                                                    | Beskrivelse              |
|---------------|------------------------------------------------------------|--------------------------|
| `status`      | `{ status: 'preparing' \| 'searching' \| 'generating' }`  | Fremdriftsindikator      |
| `delta`       | `{ delta: "..." }`                                         | Tekstfragment fra GPT    |
| `done`        | `{ done: true, sources: [...] }`                           | Svar ferdig + kildeliste |
| `suggestions` | `{ suggestions: ["?", "?", "?"] }`                         | Oppfølgingsspørsmål      |
| `error`       | `{ error: "..." }`                                         | Feilmelding              |

---

## Rate limiting

| Endepunkt     | Grense                   |
|---------------|--------------------------|
| `/api/chat`   | 40 forespørsler / 10 min |
| `/api/upload` | 20 opplastinger / time   |

---

## Deploy på Railway

Repoet inneholder Railway-konfig i [`railway.json`](./railway.json).

### 1. Opprett tjenester

1. Push repoet til GitHub.
2. I Railway: **New Project** → **Deploy from GitHub repo**.
3. Legg til PostgreSQL i samme prosjekt: **New** → **Database** → **PostgreSQL**.

### 2. Sett miljøvariabler i app-servicen

Minst disse:
- `OPENAI_API_KEY`
- `ACCESS_PASSWORD`
- `ADMIN_PASSWORD`
- `CHAT_MODEL` (valgfritt, standard er `gpt-4o-mini`)

DB-tilkobling:
- Railway setter vanligvis `DATABASE_URL` automatisk når Postgres er koblet til service.
- Alternativt støttes også Railway sine `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`.

### 3. Kjør databaseskjema én gang

Etter at Postgres er opprettet må skjemaet kjøres mot Railway-databasen:

```bash
psql "<DATABASE_URL>" -f src/db/schema.sql
```

`schema.sql` oppretter både tabeller og `vector`-utvidelsen (`CREATE EXTENSION IF NOT EXISTS vector;`).

---

## HTTPS i produksjon

Bruk `nginx.conf.example` som utgangspunkt. Certbot utsteder og fornyer TLS-sertifikater gratis:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d ditt-domene.no
sudo cp nginx.conf.example /etc/nginx/sites-available/is217
# Erstatt «ditt-domene.no» i konfig-filen
sudo nginx -t && sudo systemctl reload nginx
```

nginx er konfigurert med `proxy_buffering off` slik at SSE-streaming fungerer korrekt.

---

## Teknologivalg og begrunnelse
>>>>>>> b3e4f09a09c6a03b50caf975e11948dabdf24b6c

| Valg | Alternativ | Begrunnelse |
|------|------------|-------------|
| pgvector | Pinecone, Qdrant | Alt i én database, ingen ekstern tjeneste |
| text-embedding-3-small | ada-002, 3-large | Billigst, 1536 dim, god nok for norske tekster |
| gpt-4o-mini | gpt-4o, Claude | Billigst av GPT-modellene, god norsk støtte |
| HNSW-indeks | IVFFlat | Raskere søk, krever ikke VACUUM etter inserts |
| HyDE | Direkte embedding | Genererer hypotetisk svar først – mer semantisk rike søkevektorer |
| Multi-query retrieval | Enkelt søk | Parallelle søk med ulike formuleringer gir bedre dekning |
| Semantisk chunking | Fast tegn-splitting | Overskrifter starter alltid ny chunk – bevarer dokumentstruktur |
| SSE streaming | REST + polling | Sanntidsstrøm uten WebSocket-overhead |
| localStorage | sessionStorage | Samtalen overlever lukking av nettleserfanen |
| Winston + DailyRotateFile | console.log | Strukturert logging med automatisk rotasjon |
| cookie-parser + crypto | JWT / Passport | Enkel passordbeskyttelse uten ekstern avhengighet |
| EJS | React, Vue | Minimal kompleksitet, ingen build-steg |
| express-rate-limit | Egendefinert | Enkel beskyttelse mot API-misbruk |
| Jest | Mocha, Vitest | Innebygd mocking, ingen konfig nødvendig |
| Sentry | Datadog | Gratis tier, automatisk fangst av 5xx-feil |
