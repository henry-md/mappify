import Image from "next/image";
import type { ReactNode } from "react";

import type { ImageAsset, MapDraft } from "@/lib/map-draft-types";

type DraftMapPreviewProps = {
  draft: MapDraft;
  imageAsset?: ImageAsset;
  showInlineLabels?: boolean;
  showVisiblePolygons?: boolean;
  showSupportPolygons?: boolean;
  showLabelBoxes?: boolean;
  showSeedPoints?: boolean;
  showSeedLines?: boolean;
  showAnchors?: boolean;
  colorAnchorsByDerivation?: boolean;
  showDebugGrid?: boolean;
};

function polygonPoints(
  points: { x: number; y: number }[],
  width: number,
  height: number,
) {
  return points
    .map((point) => `${Math.round(point.x * width)},${Math.round(point.y * height)}`)
    .join(" ");
}

function anchorStyles(colorAnchorsByDerivation: boolean, derivation: string) {
  if (!colorAnchorsByDerivation) {
    return {
      fill: "white",
      stroke: "rgba(0,0,0,0.45)",
    };
  }

  if (derivation === "model-vision") {
    return {
      fill: "#38bdf8",
      stroke: "rgba(8, 47, 73, 0.95)",
    };
  }

  if (derivation === "model-seed-point") {
    return {
      fill: "#60a5fa",
      stroke: "rgba(30, 64, 175, 0.95)",
    };
  }

  if (derivation === "segmented-region-center") {
    return {
      fill: "#34d399",
      stroke: "rgba(6, 78, 59, 0.9)",
    };
  }

  return {
    fill: "#fbbf24",
    stroke: "rgba(120, 53, 15, 0.95)",
  };
}

export function DraftMapPreview({
  draft,
  imageAsset = draft.image,
  showInlineLabels = false,
  showVisiblePolygons = true,
  showSupportPolygons = false,
  showLabelBoxes = false,
  showSeedPoints = false,
  showSeedLines = false,
  showAnchors = true,
  colorAnchorsByDerivation = false,
  showDebugGrid = false,
}: DraftMapPreviewProps) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/30"
      style={{ aspectRatio: `${imageAsset.width} / ${imageAsset.height}` }}
    >
      {/* Keep the uploaded image and overlay in the same coordinate space so draft geometry stays aligned while scaling. */}
      <Image
        src={imageAsset.src}
        alt={draft.title}
        fill
        priority
        unoptimized
        sizes="100vw"
        className="absolute inset-0 h-full w-full object-contain"
      />
      <svg
        viewBox={`0 0 ${draft.image.width} ${draft.image.height}`}
        className="absolute inset-0 h-full w-full"
      >
        {showDebugGrid
          ? Array.from({ length: 11 }, (_, i) => i / 10).map((t) => {
              const xPx = t * draft.image.width;
              const yPx = t * draft.image.height;
              const label = t.toFixed(1);
              // Font size in viewBox units — scales with image so it's legible at any render size.
              const fs = Math.max(8, Math.round(draft.image.width * 0.022));
              return (
                <g key={t}>
                  <line
                    x1={xPx} y1={0} x2={xPx} y2={draft.image.height}
                    stroke="rgba(239,68,68,0.55)"
                    strokeWidth={draft.image.width * 0.0015}
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={0} y1={yPx} x2={draft.image.width} y2={yPx}
                    stroke="rgba(239,68,68,0.55)"
                    strokeWidth={draft.image.width * 0.0015}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={xPx + fs * 0.3}
                    y={fs * 1.1}
                    fill="rgba(239,68,68,0.95)"
                    fontSize={fs}
                    fontFamily="monospace"
                    fontWeight="bold"
                    stroke="rgba(0,0,0,0.6)"
                    strokeWidth={fs * 0.18}
                    paintOrder="stroke"
                  >
                    {label}
                  </text>
                  {t > 0 ? (
                    <text
                      x={fs * 0.25}
                      y={yPx - fs * 0.3}
                      fill="rgba(239,68,68,0.95)"
                      fontSize={fs}
                      fontFamily="monospace"
                      fontWeight="bold"
                      stroke="rgba(0,0,0,0.6)"
                      strokeWidth={fs * 0.18}
                      paintOrder="stroke"
                    >
                      {label}
                    </text>
                  ) : null}
                </g>
              );
            })
          : null}

        {showSupportPolygons
          ? draft.territories.flatMap((territory) =>
              territory.supportPolygons.map((polygon, index) => (
                <g key={`support-${territory.id}-${index}`}>
                  <polygon
                    points={polygonPoints(
                      polygon.outer,
                      draft.image.width,
                      draft.image.height,
                    )}
                    fill="rgba(251, 191, 36, 0.06)"
                    stroke="rgba(251, 191, 36, 0.95)"
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )),
            )
          : null}

        {showVisiblePolygons
          ? draft.territories.flatMap((territory) =>
              territory.polygons.map((polygon, index) => (
                <g key={`${territory.id}-${index}`}>
                  <polygon
                    points={polygonPoints(
                      polygon.outer,
                      draft.image.width,
                      draft.image.height,
                    )}
                    fill="rgba(56, 189, 248, 0.18)"
                    stroke="rgba(125, 211, 252, 0.95)"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                  {polygon.holes.map((hole, holeIndex) => (
                    <polygon
                      key={`${territory.id}-${index}-${holeIndex}`}
                      points={polygonPoints(
                        hole,
                        draft.image.width,
                        draft.image.height,
                      )}
                      fill="rgba(11, 11, 12, 0.92)"
                      stroke="rgba(125, 211, 252, 0.65)"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>
              )),
            )
          : null}

        {showLabelBoxes
          ? draft.territories.map((territory) => {
              if (!territory.labelBox) {
                return null;
              }

              const x = territory.labelBox.left * draft.image.width;
              const y = territory.labelBox.top * draft.image.height;
              const width =
                (territory.labelBox.right - territory.labelBox.left) * draft.image.width;
              const height =
                (territory.labelBox.bottom - territory.labelBox.top) * draft.image.height;

              return (
                <rect
                  key={`label-box-${territory.id}`}
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill="rgba(168, 85, 247, 0.1)"
                  stroke="rgba(216, 180, 254, 0.9)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })
          : null}

        {showSeedLines
          ? draft.territories.map((territory) => {
              if (!territory.seedPoint) {
                return null;
              }

              return (
                <line
                  key={`seed-line-${territory.id}`}
                  x1={territory.seedPoint.x * draft.image.width}
                  y1={territory.seedPoint.y * draft.image.height}
                  x2={territory.anchor.x * draft.image.width}
                  y2={territory.anchor.y * draft.image.height}
                  stroke="rgba(34, 211, 238, 0.85)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })
          : null}

        {showSeedPoints
          ? draft.territories.flatMap((territory) => {
              const elements: ReactNode[] = [];

              if (territory.seedPoint) {
                elements.push(
                  <circle
                    key={`seed-${territory.id}`}
                    cx={territory.seedPoint.x * draft.image.width}
                    cy={territory.seedPoint.y * draft.image.height}
                    r={4}
                    fill="rgba(34, 211, 238, 0.95)"
                    stroke="rgba(8, 47, 73, 0.95)"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />,
                );
              }

              territory.supportSeedPoints.forEach((point, index) => {
                elements.push(
                  <circle
                    key={`support-seed-${territory.id}-${index}`}
                    cx={point.x * draft.image.width}
                    cy={point.y * draft.image.height}
                    r={3}
                    fill="rgba(34, 211, 238, 0.55)"
                    stroke="rgba(8, 47, 73, 0.65)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />,
                );
              });

              return elements;
            })
          : null}

        {showAnchors
          ? draft.territories.map((territory) => {
              const styles = anchorStyles(
                colorAnchorsByDerivation,
                territory.anchorDerivation,
              );

              return (
                <g key={territory.id}>
                  <circle
                    cx={territory.anchor.x * draft.image.width}
                    cy={territory.anchor.y * draft.image.height}
                    r={6}
                    fill={styles.fill}
                    stroke={styles.stroke}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                  {showInlineLabels ? (
                    <text
                      x={territory.anchor.x * draft.image.width + 9}
                      y={territory.anchor.y * draft.image.height - 9}
                      fill="white"
                      fontSize={12}
                      fontWeight={600}
                      stroke="rgba(0,0,0,0.7)"
                      strokeWidth={2}
                      paintOrder="stroke"
                    >
                      {territory.label}
                    </text>
                  ) : null}
                </g>
              );
            })
          : null}
      </svg>
    </div>
  );
}
