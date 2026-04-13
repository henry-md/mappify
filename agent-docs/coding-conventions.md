Databases:
You are ONLY allowed to make db migrations with `npx prisma migrate dev --name <migration_name>`, and regenerate the client with `npx prisma generate`, and absolutely nothing else. If that doesn't work, you are not even allowed to run it again! You must give me your suggestion for what to run. NEVER, EVER, under ANY CIRCUMSTANCES can you run things like `db push`, `migrate deploy`, `db pull`, or anything else. This is punishable by death.

Package management:
Prefer `pnpm` over `npm` for install, dev, build, lint, and other package-script commands unless there is a specific reason not to.

Verification:
After code changes, especially UI/component edits, always run a compiler check (`pnpm exec tsc --noEmit`) before finishing. Lint is not enough on its own.

Commits:
Never commit anything. Let the user do git add, etc, unless explicitly asked.

Comments:
Make them! Prefer a small number of high-signal comments above non-obvious code blocks,
especially shell scripts, deployment logic, bootstrap flows, and integration workarounds, but rly any complex codeblock. Focus on explaining why the block exists or what constraint it is handling, not narrating obvious line-by-line behavior. I would also like a 1-2 line comment above long functions and classes to explain what they do (do NOT go overboard in comments here, don't create large documentation above these functions)
