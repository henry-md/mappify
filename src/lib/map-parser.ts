import OpenAI from "openai";
import { toFile } from "openai";
import sharp from "sharp";

import {
  deriveGeometryFromImage,
  deriveGeometryFromOutlineImage,
  loadRasterImage,
} from "@/lib/map-support-geometry";
import { saveDerivedImageAsset } from "@/lib/map-draft-store";
import type {
  DraftDebugArtifacts,
  GeometryStrategy,
  GeometryPreference,
  InteractionMode,
  NormalizedBox,
  NormalizedPoint,
  ParsedDraftPayload,
  PolygonRegion,
  TerritoryDraft,
  TerritoryGeometryMode,
} from "@/lib/map-draft-types";

type DerivedGeometryResults = Awaited<ReturnType<typeof deriveGeometryFromImage>>;

type NormalizedSemanticTarget = {
  label: string;
  labelBox: NormalizedBox | null;
  seedPoint: NormalizedPoint | null;
  supportSeedPoints: NormalizedPoint[];
  geometryModeHint: TerritoryGeometryMode;
  rawConfidence: number;
  rawNotes: string[];
};

type RawParserPolygon = {
  points?: Array<Partial<NormalizedPoint>>;
};

type RawParserTerritory = {
  label?: string;
  geometryMode?: TerritoryGeometryMode;
  geometryModeHint?: TerritoryGeometryMode;
  anchor?: Partial<NormalizedPoint>;
  seedPoint?: Partial<NormalizedPoint>;
  supportPoints?: Array<Partial<NormalizedPoint>>;
  labelBox?: Partial<NormalizedBox>;
  polygons?: RawParserPolygon[];
  confidence?: number;
  notes?: string[];
};

type RawParserPayload = {
  diagramKind?: ParsedDraftPayload["diagramKind"];
  recommendedInteraction?: InteractionMode;
  inferredSubject?: string;
  summary?: string;
  warnings?: string[];
  territories?: RawParserTerritory[];
};

const SEEDED_PRIOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "diagramKind",
    "recommendedInteraction",
    "inferredSubject",
    "summary",
    "warnings",
    "territories",
  ],
  properties: {
    diagramKind: {
      type: "string",
      enum: ["map", "medical", "diagram", "unknown"],
    },
    recommendedInteraction: {
      type: "string",
      enum: ["points", "regions", "hybrid"],
    },
    inferredSubject: { type: "string" },
    summary: { type: "string" },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    territories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "geometryModeHint",
          "seedPoint",
          "supportPoints",
          "labelBox",
          "confidence",
          "notes",
        ],
        properties: {
          label: { type: "string" },
          geometryModeHint: {
            type: "string",
            enum: ["point", "polygon", "hybrid"],
          },
          seedPoint: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y"],
            properties: {
              x: { type: "number" },
              y: { type: "number" },
            },
          },
          supportPoints: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["x", "y"],
              properties: {
                x: { type: "number" },
                y: { type: "number" },
              },
            },
          },
          labelBox: {
            type: "object",
            additionalProperties: false,
            required: ["left", "top", "right", "bottom"],
            properties: {
              left: { type: "number" },
              top: { type: "number" },
              right: { type: "number" },
              bottom: { type: "number" },
            },
          },
          confidence: { type: "number" },
          notes: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

const MODEL_GEOMETRY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "diagramKind",
    "recommendedInteraction",
    "inferredSubject",
    "summary",
    "warnings",
    "territories",
  ],
  properties: {
    diagramKind: {
      type: "string",
      enum: ["map", "medical", "diagram", "unknown"],
    },
    recommendedInteraction: {
      type: "string",
      enum: ["points", "regions", "hybrid"],
    },
    inferredSubject: { type: "string" },
    summary: { type: "string" },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    territories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "geometryMode",
          "anchor",
          "labelBox",
          "polygons",
          "confidence",
          "notes",
        ],
        properties: {
          label: { type: "string" },
          geometryMode: {
            type: "string",
            enum: ["point", "polygon", "hybrid"],
          },
          anchor: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y"],
            properties: {
              x: { type: "number" },
              y: { type: "number" },
            },
          },
          labelBox: {
            type: "object",
            additionalProperties: false,
            required: ["left", "top", "right", "bottom"],
            properties: {
              left: { type: "number" },
              top: { type: "number" },
              right: { type: "number" },
              bottom: { type: "number" },
            },
          },
          polygons: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["points"],
              properties: {
                points: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["x", "y"],
                    properties: {
                      x: { type: "number" },
                      y: { type: "number" },
                    },
                  },
                },
              },
            },
          },
          confidence: { type: "number" },
          notes: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizePoint(point?: Partial<NormalizedPoint>): NormalizedPoint {
  return {
    x: clamp01(point?.x ?? 0.5),
    y: clamp01(point?.y ?? 0.5),
  };
}

function pointEquals(a: NormalizedPoint, b: NormalizedPoint) {
  return Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001;
}

function closeLoop(points: NormalizedPoint[]) {
  if (points.length < 3) {
    return [];
  }

  const cleaned = points.map(normalizePoint);
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];

  if (!pointEquals(first, last)) {
    cleaned.push(first);
  }

  return cleaned;
}

function boxCenter(box: NormalizedBox): NormalizedPoint {
  return {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  };
}

function normalizeBox(box?: Partial<NormalizedBox>): NormalizedBox | null {
  if (
    !box ||
    box.left === undefined ||
    box.top === undefined ||
    box.right === undefined ||
    box.bottom === undefined
  ) {
    return null;
  }

  const left = clamp01(Math.min(box.left, box.right));
  const right = clamp01(Math.max(box.left, box.right));
  const top = clamp01(Math.min(box.top, box.bottom));
  const bottom = clamp01(Math.max(box.top, box.bottom));

  if (right - left < 0.001 || bottom - top < 0.001) {
    return null;
  }

  return { left, top, right, bottom };
}

function normalizePolygonRegion(polygon: RawParserPolygon) {
  const outer = closeLoop((polygon.points ?? []).map(normalizePoint));

  if (outer.length < 4) {
    return null;
  }

  const holes: NormalizedPoint[][] = [];

  return {
    outer,
    holes,
  } satisfies PolygonRegion;
}

function fallbackTerritories(preference: GeometryPreference): TerritoryDraft[] {
  return [
    {
      id: crypto.randomUUID(),
      label: "Primary target",
      geometryMode: preference === "regions" ? "hybrid" : "point",
      anchor: { x: 0.5, y: 0.5 },
      polygons: [],
      supportPolygons: [],
      labelBox: null,
      seedPoint: null,
      supportSeedPoints: [],
      anchorDerivation: "canvas-center",
      debugRegionMatchScore: null,
      confidence: 0.1,
      notes: [
        "Automatic parsing needs an OpenAI API key to produce a richer draft.",
      ],
    },
  ];
}

function extractJsonPayload(rawText: string) {
  const fencedMatch = rawText.match(/```json\s*([\s\S]*?)```/i);

  if (fencedMatch) {
    return fencedMatch[1];
  }

  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return rawText.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("The parser response did not include JSON.");
}

function getGeometryStrategy(): GeometryStrategy {
  const strategy = process.env.OPENAI_MAP_GEOMETRY_STRATEGY;

  if (
    strategy === "outline-generation" ||
    strategy === "model" ||
    strategy === "segmentation"
  ) {
    return strategy;
  }

  return "seeded";
}

function buildSegmentationPrompt(preference: GeometryPreference) {
  return [
    "You are identifying labeled targets inside an uploaded map or diagram.",
    "First identify what real place, anatomy subject, or diagram subject the image is depicting.",
    "Use the visible labels plus your general reference knowledge about that place or subject to interpret ambiguous text and borders.",
    "If a map appears to depict a recognizable real-world region, use common reference maps of that region as context when a local edge is noisy or stylized.",
    "Do not invent impossible adjacencies or boundaries that conflict with the inferred subject.",
    "Return JSON only.",
    "Do not return anchors.",
    "Do not return polygons.",
    "The application derives anchors deterministically from image geometry after your response.",
    "For each target, return a label box that tightly covers the rendered text for that label.",
    "Use geometryModeHint='point' when visible region outlines are not worth showing to the user.",
    "Use geometryModeHint='hybrid' or 'polygon' only when the image appears to contain a real region behind the label.",
    "Medical or pointer-heavy diagrams should usually prefer point mode.",
    `The user's geometry preference is: ${preference}.`,
    'Use this JSON shape: {"diagramKind":"map|medical|diagram|unknown","recommendedInteraction":"points|regions|hybrid","summary":"...","warnings":["..."],"territories":[{"label":"...","geometryModeHint":"point|polygon|hybrid","labelBox":{"left":0.1,"top":0.1,"right":0.2,"bottom":0.16},"confidence":0.0,"notes":["..."]}]}',
  ].join("\n");
}

function buildSeededSegmentationPrompt(preference: GeometryPreference) {
  return [
    "You are preparing semantic priors for a deterministic map and diagram segmentation pipeline.",
    "Work directly from the original image. Do not imagine a redrawn or regenerated version of it.",
    "First infer what real place, anatomy subject, or diagram subject the image is intended to show.",
    "Use that inferred subject as context for the whole task.",
    "If the image appears to depict a recognizable real-world region, use your general knowledge of that region and common reference maps of it to resolve ambiguous coastlines, borders, islands, and territory adjacencies.",
    "If the image appears to depict a known anatomy or educational diagram, use common reference diagrams of that subject as context when edges are stylized or partially obscured.",
    "Return semantic priors only.",
    "At the top level, include inferredSubject as a short plain-English description of what the image depicts.",
    "Do not return polygons.",
    "Do not return the final displayed anchor.",
    "For each visible named target, return:",
    "- the full human-readable label",
    "- a geometryModeHint",
    "- a tight label box around the rendered text",
    "- one primary seedPoint inside the intended territory or feature",
    "- zero to three additional supportPoints that also sit inside the same territory and help define its interior",
    "Seed points must stay away from label text and borders when possible.",
    "For long, narrow, or concave regions, spread supportPoints across the interior instead of clustering them together.",
    "If the target is tiny or the boundary is too uncertain, use geometryModeHint='point' and return only a safe seedPoint with an empty or minimal supportPoints list.",
    "Keep all coordinates normalized to the original image in [0,1].",
    "When text is split across lines or stylized, collapse it into the full label humans would use.",
    "Do not merge neighboring named territories into one entry.",
    "Do not let text placement override known territorial relationships when the intended region is clear from the image.",
    "Use notes or warnings when the inferred subject, seed placement, or a boundary is meaningfully uncertain.",
    `The user's geometry preference is: ${preference}.`,
  ].join("\n");
}

function buildOutlineHelperPrompt({
  title,
  inferredSubject,
}: {
  title: string;
  inferredSubject: string | null;
}) {
  return [
    "This is a map or labeled regional diagram.",
    "Please return an image that is the same, pixel for pixel, except you outline the different territories with gold outlines, and remove absolutely everything else from the image except the gold outlines.",
    "Use a black background wherever content has been removed so that only the gold outlines remain visible.",
    "Make sure the outlines that should be adjacent are adjacent, and formed just as a thin gold border.",
    "It is important that the result maps back onto the original image pixel-for-pixel because a later step will analyze your new image and map those regions onto the old image.",
    "Make sure the resulting image is the exact same dimensions for the same reason.",
    "Before drawing, identify what real place, anatomy subject, or diagram subject the source image is supposed to depict.",
    inferredSubject
      ? `The current semantic pass believes the subject is: ${inferredSubject}. Use that for context unless the image clearly contradicts it.`
      : "Infer the subject from the image itself before deciding any ambiguous edges.",
    "If the location or subject is recognizable, use that context when resolving ambiguous borders or coastlines.",
    "If it depicts a recognizable real-world region, reference other common maps or diagrams of that region if unsure.",
    "Preserve the same orientation, placement, silhouette, coastline, islands, and adjacency relationships as the source image.",
    "Do not simplify irregular or curved borders into generic geometric shapes.",
    "Draw the outer boundary and every internal shared border exactly once so adjacent regions share the same line.",
    "Close small gaps when the source strongly implies a closed region.",
    "Do not invent extra regions that are not present in the source.",
    "Do not add text, labels, legend, fills, glow, shading, watermark cleanup artifacts, or any extra color.",
    "Return only the derived helper image, not an explanation.",
    `Image title: ${title}`,
  ].join("\n");
}

function buildModelGeometryPrompt(preference: GeometryPreference) {
  return [
    "You are drafting interactive quiz geometry for an uploaded map or diagram.",
    "Work directly from the original image. Do not imagine a redrawn or regenerated version of it.",
    "Before placing any geometry, infer what real place, anatomy subject, or diagram subject the image is intended to show.",
    "Use that inferred subject as context for the whole task.",
    "At the top level, include inferredSubject as a short plain-English description of what the image depicts.",
    "If the image appears to depict a recognizable real-world region, use your general knowledge of that region and common reference maps of it to resolve ambiguous coastlines, borders, islands, and territory adjacencies.",
    "If the image appears to depict a known anatomy or educational diagram, use common reference diagrams of that subject as context when edges are stylized or partially obscured.",
    "When the visible edge is ambiguous, prefer geometry that is globally consistent with the inferred subject rather than overfitting to local noise.",
    "If you are still unsure after using subject-level context, fall back to point mode instead of inventing a confident polygon.",
    "Return one entry per visible named target.",
    "For each target, return:",
    "- the full human-readable label",
    "- a tight label box around the rendered text",
    "- an anchor point inside the intended territory or feature",
    "- zero or more simplified polygons that follow the visible territory boundaries",
    "Anchors must sit inside the target and should avoid borders when possible.",
    "If the boundary is visually clear, prefer polygon or hybrid mode and return polygons.",
    "If the boundary is too ambiguous or too tiny, use point mode and return no polygons.",
    "Keep all coordinates normalized to the original image in [0,1].",
    "When text is split across lines or stylized, collapse it into the full label humans would use.",
    "Do not merge neighboring named territories into one entry.",
    "Do not let text placement override known territorial relationships when the intended region is clear from the image.",
    "Polygons should be simplified draft geometry, not pixel-perfect traces, and should usually use roughly 4 to 18 points.",
    "Use notes or warnings when the inferred subject or a boundary is meaningfully uncertain.",
    `The user's geometry preference is: ${preference}.`,
  ].join("\n");
}

function mimeTypeFromDataUrl(dataUrl: string) {
  return dataUrl.match(/^data:([^;]+);/i)?.[1] ?? "application/octet-stream";
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  if (mimeType === "image/png") {
    return "png";
  }

  return "bin";
}

function fallbackParsedPayload({
  preference,
  inferredSubject,
  summary,
  warnings,
}: {
  preference: GeometryPreference;
  inferredSubject: string | null;
  summary: string;
  warnings: string[];
}): ParsedDraftPayload {
  return {
    diagramKind: "unknown",
    recommendedInteraction: preference === "regions" ? "hybrid" : "points",
    inferredSubject,
    summary,
    warnings,
    territories: fallbackTerritories(preference),
  };
}

function normalizeSemanticTargets(
  payload: RawParserPayload,
  preference: GeometryPreference,
) {
  const rawTerritories = (payload.territories ?? []).filter(
    (territory) => territory.label?.trim(),
  );

  const normalizedTargets = rawTerritories.map((territory, index) => ({
    label: territory.label?.trim() || `Region ${index + 1}`,
    labelBox: normalizeBox(territory.labelBox),
    seedPoint: territory.seedPoint ? normalizePoint(territory.seedPoint) : null,
    supportSeedPoints: (territory.supportPoints ?? []).map(normalizePoint),
    geometryModeHint:
      territory.geometryModeHint ??
      (preference === "points" ? "point" : "hybrid"),
    rawConfidence: territory.confidence ?? 0.55,
    rawNotes: territory.notes?.filter(Boolean) ?? [],
  })) satisfies NormalizedSemanticTarget[];

  return {
    rawTerritories,
    normalizedTargets,
  };
}

function buildDerivedPayload({
  payload,
  preference,
  model,
  normalizedTargets,
  derivedTargets,
  seededSummary,
  labelFallbackWarning,
  seedFallbackWarning,
}: {
  payload: RawParserPayload;
  preference: GeometryPreference;
  model: string | null;
  normalizedTargets: NormalizedSemanticTarget[];
  derivedTargets: DerivedGeometryResults;
  seededSummary: string;
  labelFallbackWarning: (count: number) => string;
  seedFallbackWarning: (count: number) => string;
}): ParsedDraftPayload {
  if (normalizedTargets.length === 0) {
    return fallbackParsedPayload({
      preference,
      inferredSubject: payload.inferredSubject?.trim() || null,
      summary: "The parser could not confidently extract draft territories from this image.",
      warnings: [
        ...(model
          ? ["The model returned no usable regions, so a point-first draft is safer."]
          : []),
      ],
    });
  }

  const territories = normalizedTargets.map((target, index) => {
    const derived = derivedTargets[index];
    const visibleGeometryMode =
      derived.visiblePolygons.length === 0
        ? "point"
        : target.geometryModeHint === "polygon"
          ? "polygon"
          : "hybrid";

    return {
      id: crypto.randomUUID(),
      label: target.label,
      geometryMode: visibleGeometryMode,
      anchor: derived.anchor,
      polygons: derived.visiblePolygons,
      supportPolygons: derived.supportPolygons,
      labelBox: target.labelBox,
      seedPoint: derived.seedPoint,
      supportSeedPoints: derived.supportSeedPoints,
      anchorDerivation: derived.derivation,
      debugRegionMatchScore: derived.matchScore,
      confidence: clamp01(target.rawConfidence + derived.confidenceDelta),
      notes: [...target.rawNotes, ...derived.notes],
    } satisfies TerritoryDraft;
  });
  const warnings = [...(payload.warnings?.filter(Boolean) ?? [])];
  const fallbackCount = territories.filter(
    (territory) => territory.anchorDerivation === "label-box-center",
  ).length;
  const seedFallbackCount = territories.filter(
    (territory) => territory.anchorDerivation === "model-seed-point",
  ).length;

  if (fallbackCount > 0) {
    warnings.push(labelFallbackWarning(fallbackCount));
  }

  if (seedFallbackCount > 0) {
    warnings.push(seedFallbackWarning(seedFallbackCount));
  }

  return {
    diagramKind: payload.diagramKind ?? "unknown",
    recommendedInteraction:
      payload.recommendedInteraction ??
      (territories.some((territory) => territory.polygons.length > 0)
        ? "hybrid"
        : "points"),
    inferredSubject: payload.inferredSubject?.trim() || null,
    summary: payload.summary?.trim() || seededSummary,
    warnings,
    territories,
  };
}

function normalizeModelGeometryPayload(
  payload: RawParserPayload,
  preference: GeometryPreference,
  model: string | null,
): ParsedDraftPayload {
  const rawTerritories = (payload.territories ?? []).filter(
    (territory) => territory.label?.trim(),
  );

  if (rawTerritories.length === 0) {
    return {
      diagramKind: "unknown",
      recommendedInteraction: preference === "regions" ? "hybrid" : "points",
      inferredSubject: payload.inferredSubject?.trim() || null,
      summary:
        "The model could not confidently extract draft territories from this image.",
      warnings: [
        ...(model ? ["The model returned no usable targets, so a point-first draft is safer."] : []),
      ],
      territories: fallbackTerritories(preference),
    };
  }

  const territories = rawTerritories.map((territory, index) => {
    const label = territory.label?.trim() || `Region ${index + 1}`;
    const labelBox = normalizeBox(territory.labelBox);
    const polygons = (territory.polygons ?? [])
      .map(normalizePolygonRegion)
      .filter((polygon): polygon is PolygonRegion => polygon !== null);
    const anchor = territory.anchor
      ? normalizePoint(territory.anchor)
      : labelBox
        ? boxCenter(labelBox)
        : { x: 0.5, y: 0.5 };
    const requestedMode =
      territory.geometryMode ??
      (polygons.length > 0
        ? preference === "points"
          ? "hybrid"
          : "polygon"
        : "point");
    const geometryMode =
      polygons.length === 0
        ? "point"
        : requestedMode === "polygon"
          ? "polygon"
          : "hybrid";

    return {
      id: crypto.randomUUID(),
      label,
      geometryMode,
      anchor,
      polygons,
      supportPolygons: polygons,
      labelBox,
      seedPoint: null,
      supportSeedPoints: [],
      anchorDerivation: "model-vision",
      debugRegionMatchScore: null,
      confidence: clamp01(territory.confidence ?? (polygons.length > 0 ? 0.88 : 0.78)),
      notes: territory.notes?.filter(Boolean) ?? [],
    } satisfies TerritoryDraft;
  });

  return {
    diagramKind: payload.diagramKind ?? "unknown",
    recommendedInteraction:
      payload.recommendedInteraction ??
      (territories.some((territory) => territory.polygons.length > 0)
        ? "hybrid"
        : "points"),
    inferredSubject: payload.inferredSubject?.trim() || null,
    summary:
      payload.summary?.trim() ||
      "Created a draft spatial layer directly from the model's image understanding.",
    warnings: [...(payload.warnings?.filter(Boolean) ?? [])],
    territories,
  };
}

async function normalizeSegmentedPayload({
  payload,
  preference,
  model,
  buffer,
  image,
}: {
  payload: RawParserPayload;
  preference: GeometryPreference;
  model: string | null;
  buffer: Buffer;
  image?: Awaited<ReturnType<typeof loadRasterImage>>;
}): Promise<ParsedDraftPayload> {
  const { rawTerritories, normalizedTargets } = normalizeSemanticTargets(
    payload,
    preference,
  );

  if (rawTerritories.length === 0) {
    return fallbackParsedPayload({
      preference,
      inferredSubject: payload.inferredSubject?.trim() || null,
      summary: "The parser could not confidently extract draft territories from this image.",
      warnings: [
        ...(model
          ? ["The model returned no usable regions, so a point-first draft is safer."]
          : []),
      ],
    });
  }

  const raster = image ?? (await loadRasterImage(buffer));
  const derivedTargets = await deriveGeometryFromImage({
    image: raster,
    buffer,
    targets: normalizedTargets.map((target) => ({
      label: target.label,
      labelBox: target.labelBox,
      seedPoint: target.seedPoint,
      supportSeedPoints: target.supportSeedPoints,
      geometryModeHint: target.geometryModeHint,
    })),
    geometryPreference: preference,
    diagramKind: payload.diagramKind ?? "unknown",
  });

  return buildDerivedPayload({
    payload,
    preference,
    model,
    normalizedTargets,
    derivedTargets,
    seededSummary: normalizedTargets.some((target) => target.seedPoint)
      ? "Created a draft spatial layer from OpenAI semantic seeds plus image segmentation."
      : "Created a draft spatial layer from the uploaded image.",
    labelFallbackWarning: (count) =>
      `${count} target${count === 1 ? "" : "s"} fell back to label-based anchors because region segmentation was not confident enough.`,
    seedFallbackWarning: (count) =>
      `${count} target${count === 1 ? "" : "s"} are currently using OpenAI seed points because raster segmentation could not confirm a better interior anchor.`,
  });
}

async function parseRawPayloadWithSegmentation({
  client,
  model,
  dataUrl,
  title,
  geometryPreference,
}: {
  client: OpenAI;
  model: string;
  dataUrl: string;
  title: string;
  geometryPreference: GeometryPreference;
}) {
  const response = await client.responses.create({
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${buildSegmentationPrompt(geometryPreference)}\nImage title: ${title}`,
          },
          {
            type: "input_image",
            image_url: dataUrl,
            detail: "high",
          },
        ],
      },
    ],
  });

  return JSON.parse(extractJsonPayload(response.output_text || "")) as RawParserPayload;
}

async function parseRawPayloadWithSeededPriors({
  client,
  model,
  dataUrl,
  title,
  geometryPreference,
}: {
  client: OpenAI;
  model: string;
  dataUrl: string;
  title: string;
  geometryPreference: GeometryPreference;
}) {
  const response = await client.responses.parse({
    model,
    text: {
      format: {
        type: "json_schema",
        name: "map_seed_priors",
        strict: true,
        description:
          "Structured semantic priors for seeded geometry extraction from a map or labeled diagram.",
        schema: SEEDED_PRIOR_SCHEMA,
      },
      verbosity: "medium",
    },
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${buildSeededSegmentationPrompt(geometryPreference)}\nImage title: ${title}`,
          },
          {
            type: "input_image",
            image_url: dataUrl,
            detail: "high",
          },
        ],
      },
    ],
  });

  if (!response.output_parsed) {
    throw new Error("The model did not return seeded geometry priors.");
  }

  return response.output_parsed as RawParserPayload;
}

// Ask the image model for a CV-friendly helper image, then snap it back onto the
// original canvas size so traced polygons still align with the uploaded source.
async function generateOutlineHelperImage({
  client,
  draftId,
  title,
  inferredSubject,
  sourceBuffer,
  sourceMimeType,
  sourceWidth,
  sourceHeight,
}: {
  client: OpenAI;
  draftId: string;
  title: string;
  inferredSubject: string | null;
  sourceBuffer: Buffer;
  sourceMimeType: string;
  sourceWidth: number;
  sourceHeight: number;
}): Promise<{
  buffer: Buffer;
  debug: DraftDebugArtifacts;
}> {
  const prompt = buildOutlineHelperPrompt({ title, inferredSubject });
  const outlineModel = process.env.OPENAI_MAP_OUTLINE_MODEL ?? "gpt-image-1";
  const response = await client.images.edit({
    model: outlineModel,
    image: await toFile(
      sourceBuffer,
      `${draftId}-source.${extensionForMimeType(sourceMimeType)}`,
      {
        type: sourceMimeType,
      },
    ),
    prompt,
    input_fidelity: "high",
    quality: "high",
    size: "auto",
    output_format: "png",
    background: "opaque",
  });
  const image = response.data?.[0];

  if (!image?.b64_json) {
    throw new Error("The outline helper image did not return usable PNG data.");
  }

  // The image edit API chooses from a fixed output size set, so we rescale the helper
  // back onto the original canvas before tracing contours to keep coordinates aligned.
  const resizedBuffer = await sharp(Buffer.from(image.b64_json, "base64"))
    .resize(sourceWidth, sourceHeight, { fit: "fill" })
    .png()
    .toBuffer();
  const outlineHelperImage = await saveDerivedImageAsset({
    draftId,
    stem: "outline-helper",
    buffer: resizedBuffer,
    mimeType: "image/png",
    originalFilename: "outline-helper.png",
  });

  return {
    buffer: resizedBuffer,
    debug: {
      outlineHelperImage,
      outlineHelperPrompt: prompt,
      outlineHelperModel: outlineModel,
    },
  };
}

async function normalizeOutlinePayload({
  payload,
  preference,
  model,
  outlineBuffer,
}: {
  payload: RawParserPayload;
  preference: GeometryPreference;
  model: string | null;
  outlineBuffer: Buffer;
}): Promise<ParsedDraftPayload> {
  const { rawTerritories, normalizedTargets } = normalizeSemanticTargets(
    payload,
    preference,
  );

  if (rawTerritories.length === 0) {
    return fallbackParsedPayload({
      preference,
      inferredSubject: payload.inferredSubject?.trim() || null,
      summary: "The parser could not confidently extract draft territories from this image.",
      warnings: [
        ...(model
          ? ["The model returned no usable regions, so a point-first draft is safer."]
          : []),
      ],
    });
  }

  const outlineImage = await loadRasterImage(outlineBuffer);
  const derivedTargets = await deriveGeometryFromOutlineImage({
    image: outlineImage,
    targets: normalizedTargets.map((target) => ({
      label: target.label,
      labelBox: target.labelBox,
      seedPoint: target.seedPoint,
      supportSeedPoints: target.supportSeedPoints,
      geometryModeHint: target.geometryModeHint,
    })),
    geometryPreference: preference,
    diagramKind: payload.diagramKind ?? "unknown",
  });

  return buildDerivedPayload({
    payload,
    preference,
    model,
    normalizedTargets,
    derivedTargets,
    seededSummary:
      "Created a draft spatial layer from OpenAI semantic seeds plus an OpenAI-generated outline helper image.",
    labelFallbackWarning: (count) =>
      `${count} target${count === 1 ? "" : "s"} fell back to label-based anchors because outline tracing was not confident enough.`,
    seedFallbackWarning: (count) =>
      `${count} target${count === 1 ? "" : "s"} are currently using OpenAI seed points because the outline helper could not confirm a better interior anchor.`,
  });
}

async function parseRawPayloadWithModelGeometry({
  client,
  model,
  dataUrl,
  title,
  geometryPreference,
}: {
  client: OpenAI;
  model: string;
  dataUrl: string;
  title: string;
  geometryPreference: GeometryPreference;
}) {
  const response = await client.responses.parse({
    model,
    text: {
      format: {
        type: "json_schema",
        name: "map_draft_geometry",
        strict: true,
        description:
          "Structured draft geometry for a map or labeled diagram, including anchors, label boxes, and optional simplified polygons.",
        schema: MODEL_GEOMETRY_SCHEMA,
      },
      verbosity: "medium",
    },
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${buildModelGeometryPrompt(geometryPreference)}\nImage title: ${title}`,
          },
          {
            type: "input_image",
            image_url: dataUrl,
            detail: "high",
          },
        ],
      },
    ],
  });

  if (!response.output_parsed) {
    throw new Error("The model did not return structured map geometry.");
  }

  return response.output_parsed as RawParserPayload;
}

export async function parseDraftFromImage({
  draftId,
  buffer,
  dataUrl,
  title,
  geometryPreference,
}: {
  draftId: string;
  buffer: Buffer;
  dataUrl: string;
  title: string;
  geometryPreference: GeometryPreference;
}): Promise<{
  payload: ParsedDraftPayload;
  provider: "openai" | "fallback";
  model: string | null;
  strategy: GeometryStrategy;
  debug: DraftDebugArtifacts;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  const geometryStrategy = getGeometryStrategy();
  const defaultModel =
    geometryStrategy === "segmentation" ? "gpt-5-mini" : "gpt-4o";
  const model = process.env.OPENAI_MAP_MODEL ?? defaultModel;
  const emptyDebug: DraftDebugArtifacts = {
    outlineHelperImage: null,
    outlineHelperPrompt: null,
    outlineHelperModel: null,
  };

  if (!apiKey) {
    return {
      payload: {
        diagramKind: "unknown",
        recommendedInteraction:
          geometryPreference === "regions" ? "hybrid" : "points",
        inferredSubject: null,
        summary:
          "Saved the upload, but OpenAI parsing is not configured in this environment yet.",
        warnings: [
          "Set OPENAI_API_KEY to generate real territory drafts from uploads.",
        ],
        territories: fallbackTerritories(geometryPreference),
      },
      provider: "fallback",
      model: null,
      strategy: geometryStrategy,
      debug: emptyDebug,
    };
  }

  const client = new OpenAI({ apiKey });
  const originalRaster =
    geometryStrategy === "model" ? null : await loadRasterImage(buffer);
  let debug = emptyDebug;

  const rawPayload =
    geometryStrategy === "model"
      ? await parseRawPayloadWithModelGeometry({
          client,
          model,
          dataUrl,
          title,
          geometryPreference,
        })
      : geometryStrategy === "segmentation"
        ? await parseRawPayloadWithSegmentation({
            client,
            model,
            dataUrl,
            title,
            geometryPreference,
          })
        : await parseRawPayloadWithSeededPriors({
            client,
            model,
            dataUrl,
            title,
            geometryPreference,
          });

  if (geometryStrategy === "outline-generation" && originalRaster) {
    try {
      const outlineHelper = await generateOutlineHelperImage({
        client,
        draftId,
        title,
        inferredSubject: rawPayload.inferredSubject?.trim() || null,
        sourceBuffer: buffer,
        sourceMimeType: mimeTypeFromDataUrl(dataUrl),
        sourceWidth: originalRaster.width,
        sourceHeight: originalRaster.height,
      });

      debug = outlineHelper.debug;

      return {
        payload: await normalizeOutlinePayload({
          payload: rawPayload,
          preference: geometryPreference,
          model,
          outlineBuffer: outlineHelper.buffer,
        }),
        provider: "openai",
        model,
        strategy: geometryStrategy,
        debug,
      };
    } catch (error) {
      const fallbackPayload = await normalizeSegmentedPayload({
        payload: rawPayload,
        preference: geometryPreference,
        model,
        buffer,
        image: originalRaster,
      });

      return {
        payload: {
          ...fallbackPayload,
          warnings: [
            `Outline helper generation failed, so this draft fell back to the seeded raster path: ${
              error instanceof Error ? error.message : "Unknown helper generation error."
            }`,
            ...fallbackPayload.warnings,
          ],
        },
        provider: "openai",
        model,
        strategy: geometryStrategy,
        debug,
      };
    }
  }

  return {
    payload:
      geometryStrategy === "model"
        ? normalizeModelGeometryPayload(rawPayload, geometryPreference, model)
        : await normalizeSegmentedPayload({
            payload: rawPayload,
            preference: geometryPreference,
            model,
            buffer,
            image: originalRaster ?? undefined,
          }),
    provider: "openai",
    model,
    strategy: geometryStrategy,
    debug,
  };
}
