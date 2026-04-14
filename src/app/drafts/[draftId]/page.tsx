import Link from "next/link";
import { notFound } from "next/navigation";

import { DraftMapPreview } from "@/components/draft-map-preview";
import { isDebugUiEnabled } from "@/lib/debug-ui";
import { getDraft } from "@/lib/map-draft-store";

export const dynamic = "force-dynamic";

export default async function DraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;

  let draft;

  try {
    draft = await getDraft(draftId);
  } catch {
    notFound();
  }

  const debugUiEnabled = isDebugUiEnabled();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Link href="/" className="text-sm text-slate-400 hover:text-white">
            Back
          </Link>
          <h1 className="text-3xl font-semibold">{draft.title}</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-400">
            {draft.parsing.summary}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
          <div>{draft.territories.length} targets</div>
          <div className="text-slate-500">
            {draft.parsing.recommendedInteraction} mode
          </div>
          <div className="text-slate-500">{draft.parsing.geometryStrategy} parser</div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.5fr_0.9fr]">
        <DraftMapPreview draft={draft} />

        <aside className="space-y-6">
          {draft.parsing.warnings.length > 0 ? (
            <section className="rounded-2xl border border-amber-500/20 bg-amber-500/8 p-5">
              <h2 className="text-sm font-semibold text-amber-200">Draft warnings</h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-100/85">
                {draft.parsing.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {draft.parsing.inferredSubject ? (
            <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/8 p-5">
              <h2 className="text-sm font-semibold text-cyan-100">Inferred subject</h2>
              <p className="mt-2 text-sm leading-6 text-cyan-50/90">
                {draft.parsing.inferredSubject}
              </p>
            </section>
          ) : null}

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-sm font-semibold text-white">Targets</h2>
            <ul className="mt-4 space-y-3">
              {draft.territories.map((territory) => (
                <li
                  key={territory.id}
                  className="rounded-xl border border-white/8 bg-black/20 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{territory.label}</p>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        {territory.geometryMode}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {territory.anchorDerivation}
                      </p>
                      {debugUiEnabled ? (
                        <p className="mt-1 text-xs text-slate-500">
                          match score:{" "}
                          {territory.debugRegionMatchScore === null ||
                          territory.debugRegionMatchScore === undefined
                            ? "n/a"
                            : territory.debugRegionMatchScore.toFixed(2)}
                        </p>
                      ) : null}
                    </div>
                    <span className="text-xs text-slate-500">
                      {Math.round(territory.confidence * 100)}%
                    </span>
                  </div>
                  {territory.notes.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-sm leading-6 text-slate-400">
                      {territory.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

    </main>
  );
}
