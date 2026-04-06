# Lonestar Bark Co.
### Dallas Dog Walking — Born Here. Walk Here.

A full-stack dog walking management platform built with React + Supabase. Includes a client-facing booking portal, a walker portal, and an admin dashboard.

---

## Stack

- **Frontend** — React 18, Vite
- **Backend** — Supabase (PostgreSQL + Storage)
- **Font** — DM Sans (Google Fonts)

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/lonestar-bark.git
cd lonestar-bark
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure Supabase

The Supabase URL and anon key are set directly in `src/App.jsx` (lines 88–89). They are already configured for the Lonestar Bark Supabase project.

If you need to point to a different Supabase project, update these two constants:

```js
const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
```

### 4. Set up the database

Run `lonestar_bark_supabase_setup.sql` in the Supabase SQL Editor:

- Dashboard → SQL Editor → New Query → paste the file contents → Run

Then create the W-9 storage bucket manually:

- Dashboard → Storage → New Bucket → name: `w9-forms` → check **Public** → Save

### 5. Run locally

```bash
npm run dev
```

App runs at `http://localhost:5173`

---

## Build for production

```bash
npm run build
```

Output goes to `dist/`. Deploy to Vercel, Netlify, or any static host.

---

## Project Structure

```
lonestar-bark/
├── index.html              # HTML entry point
├── vite.config.js          # Vite config
├── package.json
├── .gitignore
├── src/
│   ├── main.jsx            # React root / mount
│   └── App.jsx             # Entire application
└── lonestar_bark_supabase_setup.sql   # DB setup script
```

---

## Portals

| Portal | Access |
|---|---|
| **Client** | Landing page → Book / Log In |
| **Walker** | Landing page → Walker Login |
| **Admin** | Landing page → Admin Login (default PIN: `0000`) |

> Change the default admin PIN immediately after first login.

---

## Lake Highlands, Dallas, Texas ★
