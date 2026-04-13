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
  const fallbackCount = draft.territories.filter(
    (territory) => territory.anchorDerivation === "label-box-center",
  ).length;
  const segmentedCount = draft.territories.filter(
    (territory) => territory.anchorDerivation === "segmented-region-center",
  ).length;
  const modelDerivedCount = draft.territories.filter(
    (territory) => territory.anchorDerivation === "model-vision",
  ).length;
  const visiblePolygonCount = draft.territories.filter(
    (territory) => territory.polygons.length > 0,
  ).length;
  const supportPolygonCount = draft.territories.filter(
    (territory) => territory.supportPolygons.length > 0,
  ).length;

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

      {debugUiEnabled ? (
        <section className="space-y-5 rounded-[2rem] border border-cyan-500/20 bg-cyan-500/6 p-6">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/80">
              Debug UI
            </p>
            <h2 className="text-xl font-semibold text-white">Parser inspection</h2>
            <p className="max-w-3xl text-sm leading-6 text-slate-300">
              Blue anchors came directly from the OpenAI geometry call. Green anchors
              came from segmented regions. Amber anchors fell back to label-box centers.
              Purple rectangles are label boxes, and the amber dashed outlines show the
              hidden geometry layer currently stored on the draft.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Model geometry
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">
                {modelDerivedCount}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Segmented
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">
                {segmentedCount}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Fallback
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">
                {fallbackCount}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Visible polygons
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">
                {visiblePolygonCount}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Hidden geometry
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">
                {supportPolygonCount}
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-3">
              <div>
                <h3 className="font-medium text-white">Step 1: Label boxes</h3>
                <p className="text-sm leading-6 text-slate-400">
                  Inspect whether the model returned boxes that actually hug the text we
                  think it saw.
                </p>
              </div>
              <DraftMapPreview
                draft={draft}
                showInlineLabels
                showVisiblePolygons={false}
                showSupportPolygons={false}
                showLabelBoxes
                colorAnchorsByDerivation
              />
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="font-medium text-white">Step 2: Support geometry</h3>
                <p className="text-sm leading-6 text-slate-400">
                  Amber dashed regions show the hidden geometry stored on the draft,
                  whether it came from the model directly or from the old segmentation
                  pipeline.
                </p>
              </div>
              <DraftMapPreview
                draft={draft}
                showInlineLabels
                showVisiblePolygons={false}
                showSupportPolygons
                showLabelBoxes={false}
                colorAnchorsByDerivation
              />
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
