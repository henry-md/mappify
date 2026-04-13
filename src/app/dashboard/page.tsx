import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SignOutButton } from "@/components/auth-button";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md space-y-3">
        <h1 className="text-lg font-medium">Dashboard</h1>
        <p className="text-sm text-slate-400">
          Signed in as {session.user.email}
        </p>
        <SignOutButton />
      </div>
    </main>
  );
}
