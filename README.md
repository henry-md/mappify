## Mappify Boilerplate

Starter stack:

- Next.js 16 App Router
- React 19
- Tailwind CSS v4
- Prisma ORM
- PostgreSQL
- Google OAuth with Auth.js

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template and point it at your Postgres database:

```bash
cp .env.example .env
```

3. Add Google OAuth credentials in the Google Cloud Console:

- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

4. Create the first migration and generate the Prisma client:

```bash
npx prisma migrate dev --name init
```

5. Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Prisma Notes

- Prisma schema lives in `prisma/schema.prisma`
- Shared Prisma client lives in `src/lib/prisma.ts`
- Auth config lives in `src/auth.ts`
- Auth route handler lives in `src/app/api/auth/[...nextauth]/route.ts`
- Google users are upserted into the `User` table on sign-in

## Useful Commands

```bash
npm run dev
npm run lint
npx prisma studio
npx prisma migrate dev
npx prisma generate
```
