# IS-217 Universellutforming – Fagassistent

En lokal RAG-basert (Retrieval-Augmented Generation) fagassistent bygd med Node.js, Express, PostgreSQL og pgvector. Appen er laget for emnet IS-217 Universellutforming, men kan brukes til ethvert fag.

Last opp PDF-, DOCX-, TXT- og MD-filer, og still spørsmål på norsk om innholdet. Appen henter de mest relevante tekstbitene og genererer svar basert på dine egne dokumenter. Botten kan også svare på hilsener og generelle spørsmål når den ikke finner relevant innhold.

---

## Arkitektur

```
Bruker
  │
  │ POST /api/upload (multipart, opptil 50 filer)
  ▼
┌──────────────────────────────────────────────────────────────────┐
│  Express (src/app.js)                                            │
│  ├── cookie-parser + auth-middleware (valgfritt passord)         │
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
│   │   ├── database.js             # pg.Pool-singleton
│   │   └── logger.js               # Winston-logger med daglig rotasjon
│   ├── db/
│   │   ├── schema.sql              # Databaseskjema + pgvector-indeks
│   │   └── migration_groups.sql    # Valgfri gruppe-isolasjon (group_id)
│   ├── middleware/
│   │   ├── auth.js                 # Passord-login (ACCESS_PASSWORD)
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
│   ├── sanitize.test.js            # Unit-tester for sanitering (12 tester)
│   └── chunker.test.js             # Unit-tester for chunking (7 tester)
├── views/
│   └── index.ejs                   # Hoved-HTML (EJS-mal)
├── public/
│   ├── css/style.css               # Stylesheet
│   └── js/chat.js                  # Frontend (SSE, localStorage, marked.js)
├── logs/                           # Winston-logger (produksjon, gitignored)
├── uploads/                        # Midlertidig fillagring (slettes etter prosessering)
├── Dockerfile                      # Container-image for appen
├── docker-compose.yml              # Starter app + PostgreSQL med én kommando
├── nginx.conf.example              # HTTPS-oppsett via nginx + Certbot
├── .env.example                    # Mal for miljøvariabler
├── package.json
└── README.md
```

---

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

| Variabel          | Påkrevd | Beskrivelse                                         |
|-------------------|---------|-----------------------------------------------------|
| `OPENAI_API_KEY`  | ✅      | Din OpenAI-nøkkel (`sk-...`)                        |
| `DB_HOST`         | ✅      | PostgreSQL-host (standard: `localhost`)             |
| `DB_NAME`         | ✅      | Databasenavn (standard: `rag_assistant`)            |
| `DB_USER`         | ✅      | Databasebruker                                      |
| `DB_PORT`         |         | PostgreSQL-port (standard: `5432`)                  |
| `DB_PASSWORD`     |         | Databasepassord                                     |
| `CHAT_MODEL`      |         | GPT-modell (standard: `gpt-4o-mini`)                |
| `ACCESS_PASSWORD` |         | Passord for innlogging – tomt = ingen autentisering |
| `SENTRY_DSN`      |         | Sentry-DSN for feilsporing – tomt = deaktivert      |

Applikasjonen stopper ved oppstart dersom `OPENAI_API_KEY`, `DB_HOST`, `DB_NAME` eller `DB_USER` mangler.

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

### Autentisering

Sett `ACCESS_PASSWORD` i `.env` for å kreve innlogging. Brukere sendes til `/login` og får en cookie som varer i én uke. Autentisering er deaktivert som standard – passer for lokal utvikling.

### Dele med gruppemedlemmer

Alle brukere som har tilgang til serveren deler samme kunnskapsbase. For å gjøre appen tilgjengelig i et nettverk:

```bash
ipconfig getifaddr en0   # macOS – finn lokal IP
ip addr show             # Linux
# Del adressen: http://192.168.x.x:3000
```

For å isolere dokumenter per gruppe, kjør migrasjonsfilen og send `group`-feltet i API-kall:

```bash
psql -U postgres -d rag_assistant -f src/db/migration_groups.sql
```

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

## Deploy på Render

Repoet inneholder nå en ferdig Blueprint-fil: [`render.yaml`](./render.yaml).

### 1. Opprett tjenester fra Blueprint

1. Push repoet til GitHub.
2. I Render: **New +** → **Blueprint**.
3. Velg repoet og opprett både:
   - `rag-assistant` (web service)
   - `rag-assistant-db` (PostgreSQL)

### 2. Sett hemmelige miljøvariabler i Render

Disse må settes manuelt i web-servicen:
- `OPENAI_API_KEY`
- `ACCESS_PASSWORD`
- `ADMIN_PASSWORD`

`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` og `DB_PASSWORD` kobles automatisk fra databasen via `render.yaml`.

### 3. Kjør databaseskjema én gang

Når databasen er opprettet må skjemaet kjøres:

```bash
psql "<EXTERNAL_DATABASE_URL>?sslmode=require" -f src/db/schema.sql
```

Bruk **External Database URL** fra Render-databasen.  
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

| Valg | Alternativ | Begrunnelse |
|------|-----------|-------------|
| pgvector | Pinecone, Qdrant, Weaviate | Alt i én database, ingen ekstern tjeneste, enklere for studenter |
| text-embedding-3-small | ada-002, text-embedding-3-large | Billigst, 1536 dim, god nok for norske tekster |
| gpt-4o-mini | gpt-4o, Claude | Billigst av GPT-modellene, god norsk støtte |
| HNSW-indeks | IVFFlat | Raskere søk, ikke krav om VACUUM etter inserts |
| HyDE | Direkte embedding av spørsmål | Genererer hypotetisk svar først – gir mer semantisk rike søkevektorer |
| Multi-query retrieval | Enkelt søk | Parallelle søk med ulike formuleringer gir bedre dekning |
| Semantisk chunking | Fast tegn-splitting | Overskrifter starter alltid ny chunk – bevarer dokumentstruktur |
| SSE streaming | REST + polling | Sanntidsstrøm uten WebSocket-overhead |
| localStorage | sessionStorage | Samtalen overlever lukking av nettleserfanen |
| Winston + DailyRotateFile | console.log / Morgan | Strukturert logging med automatisk rotasjon og arkivering |
| cookie-parser + crypto | JWT / Passport | Enkel passordbeskyttelse uten ekstern avhengighet |
| EJS | React, Vue | Minimal kompleksitet, server-side rendering, ingen build-steg |
| Multer disk storage | memory storage | Tryggere for store filer, fil slettes etter prosessering |
| express-rate-limit | Ingen / egendefinert | Enkel beskyttelse mot API-misbruk |
| Jest | Mocha, Vitest | Innebygd mocking, bred Node.js-støtte, ingen konfig nødvendig |
| Sentry | Datadog, egendefinert | Gratis tier, enkel oppsett, automatisk fangst av 5xx-feil |
