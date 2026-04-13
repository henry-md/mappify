import Image from "next/image";

import type { MapDraft } from "@/lib/map-draft-types";

type DraftMapPreviewProps = {
  draft: MapDraft;
  showInlineLabels?: boolean;
  showVisiblePolygons?: boolean;
  showSupportPolygons?: boolean;
  showLabelBoxes?: boolean;
  colorAnchorsByDerivation?: boolean;
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
  showInlineLabels = false,
  showVisiblePolygons = true,
  showSupportPolygons = false,
  showLabelBoxes = false,
  colorAnchorsByDerivation = false,
}: DraftMapPreviewProps) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/30"
      style={{ aspectRatio: `${draft.image.width} / ${draft.image.height}` }}
    >
      {/* Keep the uploaded image and overlay in the same coordinate space so draft geometry stays aligned while scaling. */}
      <Image
        src={draft.image.src}
        alt={draft.title}
        fill
        unoptimized
        sizes="100vw"
        className="absolute inset-0 h-full w-full object-contain"
      />
      <svg
        viewBox={`0 0 ${draft.image.width} ${draft.image.height}`}
        className="absolute inset-0 h-full w-full"
      >
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

        {draft.territories.map((territory) => {
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
        })}
      </svg>
    </div>
  );
}
