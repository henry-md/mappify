import Link from "next/link";

import { auth } from "@/auth";
import { SignInButton, SignOutButton } from "@/components/auth-button";

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md space-y-3">
        <h1 className="text-lg font-medium">Mappify</h1>
        {session?.user ? (
          <>
            <p className="text-sm text-slate-400">
              Signed in as {session.user.email}
            </p>
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard"
                className="rounded-md border border-white/10 px-3 py-2 text-sm"
              >
                Dashboard
              </Link>
              <SignOutButton />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-400">Sign in with Google to continue.</p>
            <SignInButton />
          </>
        )}
      </div>
    </main>
  );
}
