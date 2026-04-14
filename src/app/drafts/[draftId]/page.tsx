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
  const modelSeedFallbackCount = draft.territories.filter(
    (territory) => territory.anchorDerivation === "model-seed-point",
  ).length;
  const seedPointCount = draft.territories.filter(
    (territory) => territory.seedPoint !== null,
  ).length;
  const visiblePolygonCount = draft.territories.filter(
    (territory) => territory.polygons.length > 0,
  ).length;
  const supportPolygonCount = draft.territories.filter(
    (territory) => territory.supportPolygons.length > 0,
  ).length;
  const outlineHelperImage = draft.debug?.outlineHelperImage ?? null;
  const outlineGridImage = draft.debug?.outlineGridImage ?? null;

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

      {debugUiEnabled ? (
        <section className="space-y-5 rounded-[2rem] border border-cyan-500/20 bg-cyan-500/6 p-6">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/80">
              Debug Pipeline
            </p>
            <h2 className="text-xl font-semibold text-white">Separate parsing steps</h2>
            <p className="max-w-4xl text-sm leading-6 text-slate-300">
              Each panel is a separate stage of the pipeline. Red grid = the coordinate
              reference sent to OpenAI. Cyan points are seed priors. Green anchors came
              from traced regions; blue anchors are direct seed fallbacks; amber fell back
              to label-box centers.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">OpenAI seeds</div>
              <div className="mt-2 text-2xl font-semibold text-white">{seedPointCount}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Segmented</div>
              <div className="mt-2 text-2xl font-semibold text-white">{segmentedCount}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Seed fallback</div>
              <div className="mt-2 text-2xl font-semibold text-white">{modelSeedFallbackCount}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Hidden geometry</div>
              <div className="mt-2 text-2xl font-semibold text-white">{supportPolygonCount}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Visible polygons</div>
              <div className="mt-2 text-2xl font-semibold text-white">{visiblePolygonCount}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Label fallback</div>
              <div className="mt-2 text-2xl font-semibold text-white">{fallbackCount}</div>
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {/* Step 1: raw outline from OpenAI (outline-generation only) */}
            <div className="space-y-3">
              <div>
                <h3 className="font-medium text-white">Step 1: OpenAI Outline</h3>
                <p className="text-sm leading-6 text-slate-400">
                  {outlineHelperImage
                    ? "Black background + gold borders — exactly what OpenAI returned before any tracing."
                    : "No outline helper was generated for this strategy."}
                </p>
                {draft.debug?.outlineHelperModel ? (
                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                    {draft.debug.outlineHelperModel}
                  </p>
                ) : null}
              </div>
              <div className="mx-auto w-full max-w-[12rem]">
                {outlineHelperImage ? (
                  <DraftMapPreview
                    draft={draft}
                    imageAsset={outlineHelperImage}
                    showVisiblePolygons={false}
                    showSupportPolygons={false}
                    showSeedPoints={false}
                    showAnchors={false}
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center rounded-2xl border border-white/10 bg-black/30 text-xs text-slate-600">
                    n/a
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: outline + red coordinate grid */}
            <div className="space-y-3">
              <div>
                <h3 className="font-medium text-white">Step 2: Outline + Grid</h3>
                <p className="text-sm leading-6 text-slate-400">
                  The red grid shows the coordinate reference system OpenAI used when
                  placing seed points and label boxes.
                </p>
              </div>
              <div className="mx-auto w-full max-w-[12rem]">
                <DraftMapPreview
                  draft={draft}
                  imageAsset={outlineHelperImage ?? outlineGridImage ?? undefined}
                  showVisiblePolygons={false}
                  showSupportPolygons={false}
                  showSeedPoints={false}
                  showAnchors={false}
                  showDebugGrid
                />
              </div>
            </div>

            {/* Step 3: outline + grid + dots from structured response */}
            <div className="space-y-3">
              <div>
                <h3 className="font-medium text-white">Step 3: Outline + Grid + Dots</h3>
                <p className="text-sm leading-6 text-slate-400">
                  Seed priors and anchors overlaid on the grid. Amber dashed support
                  geometry shows where contour tracing landed. Use this to check whether
                  a bad dot is an OpenAI placement error or a tracing error.
                </p>
              </div>
              <div className="mx-auto w-full max-w-[12rem]">
                <DraftMapPreview
                  draft={draft}
                  imageAsset={outlineHelperImage ?? outlineGridImage ?? undefined}
                  showVisiblePolygons={false}
                  showSupportPolygons
                  showSeedPoints
                  showSeedLines
                  colorAnchorsByDerivation
                  showDebugGrid
                />
              </div>
            </div>

            {/* Step 4: final result on original image */}
            <div className="space-y-3">
              <div>
                <h3 className="font-medium text-white">Step 4: Final Draft</h3>
                <p className="text-sm leading-6 text-slate-400">
                  The user-facing result: original image with visible polygons and anchors
                  after all visibility rules are applied.
                </p>
              </div>
              <div className="mx-auto w-full max-w-[12rem]">
                <DraftMapPreview draft={draft} />
              </div>
            </div>
          </div>
        </section>
      ) : null}

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
