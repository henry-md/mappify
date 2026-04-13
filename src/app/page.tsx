import Image from "next/image";
import { auth } from "@/auth";
import { UploadForm } from "@/components/upload-form";
import { listDrafts } from "@/lib/map-draft-store";
import { SignInButton, SignOutButton } from "@/components/auth-button";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  const drafts = await listDrafts();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-10">
      <section className="flex flex-col gap-8 rounded-[2rem] border border-white/10 bg-white/4 p-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl space-y-4">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-500">
            Mappify
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">
            Upload a map or diagram and generate a draft quiz layer.
          </h1>
          <p className="text-base leading-7 text-slate-400">
            Every draft gets anchor points. Shapes are optional and only appear when
            they look trustworthy.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
            {session?.user ? (
              <>
                <span>Signed in as {session.user.email}</span>
                <SignOutButton />
              </>
            ) : (
              <>
                <span>Sign in to save drafts to your account later.</span>
                <SignInButton />
              </>
            )}
          </div>
        </div>

        <div className="w-full max-w-md rounded-[1.5rem] border border-white/10 bg-black/25 p-5">
          <UploadForm />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Recent drafts</h2>
          <span className="text-sm text-slate-500">{drafts.length} saved</span>
        </div>

        {drafts.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {drafts.map((draft) => (
              <Link
                key={draft.id}
                href={`/drafts/${draft.id}`}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/4 transition hover:border-white/20 hover:bg-white/6"
              >
                <div
                  className="relative border-b border-white/8 bg-black/25"
                  style={{ aspectRatio: `${draft.image.width} / ${draft.image.height}` }}
                >
                  <Image
                    src={draft.image.src}
                    alt={draft.title}
                    fill
                    unoptimized
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="space-y-2 p-4">
                  <h3 className="font-medium text-white">{draft.title}</h3>
                  <p className="line-clamp-2 text-sm leading-6 text-slate-400">
                    {draft.parsing.summary}
                  </p>
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-500">
                    <span>{draft.parsing.recommendedInteraction}</span>
                    <span>{draft.territories.length} targets</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/12 bg-white/3 p-10 text-sm text-slate-500">
            No drafts yet.
          </div>
        )}
      </section>
    </main>
  );
}
