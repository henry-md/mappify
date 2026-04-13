## Mappify Boilerplate

Starter stack:

- Next.js 16 App Router
- React 19
- Tailwind CSS v4
- Prisma ORM
- PostgreSQL

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template and point it at your Postgres database:

```bash
cp .env.example .env
```

3. Create the first migration and generate the Prisma client:

```bash
npx prisma migrate dev --name init
```

4. Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Prisma Notes

- Prisma schema lives in `prisma/schema.prisma`
- Shared Prisma client lives in `src/lib/prisma.ts`
- Health check route lives at `src/app/api/health/route.ts`
- Home page reads live database status with Prisma in a server component

## Useful Commands

```bash
npm run dev
npm run lint
npx prisma studio
npx prisma migrate dev
npx prisma generate
```
