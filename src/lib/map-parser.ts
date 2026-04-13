import OpenAI from "openai";

import {
  deriveGeometryFromImage,
  loadRasterImage,
} from "@/lib/map-support-geometry";
import type {
  GeometryPreference,
  InteractionMode,
  NormalizedBox,
  NormalizedPoint,
  ParsedDraftPayload,
  PolygonRegion,
  TerritoryDraft,
  TerritoryGeometryMode,
} from "@/lib/map-draft-types";

type GeometryStrategy = "model" | "segmentation";

type RawParserPolygon = {
  points?: Array<Partial<NormalizedPoint>>;
};

type RawParserTerritory = {
  label?: string;
  geometryMode?: TerritoryGeometryMode;
  geometryModeHint?: TerritoryGeometryMode;
  anchor?: Partial<NormalizedPoint>;
  labelBox?: Partial<NormalizedBox>;
  polygons?: RawParserPolygon[];
  confidence?: number;
  notes?: string[];
};

type RawParserPayload = {
  diagramKind?: ParsedDraftPayload["diagramKind"];
  recommendedInteraction?: InteractionMode;
  summary?: string;
  warnings?: string[];
  territories?: RawParserTerritory[];
};

const MODEL_GEOMETRY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "diagramKind",
    "recommendedInteraction",
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
  return process.env.OPENAI_MAP_GEOMETRY_STRATEGY === "segmentation"
    ? "segmentation"
    : "model";
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

function buildModelGeometryPrompt(preference: GeometryPreference) {
  return [
    "You are drafting interactive quiz geometry for an uploaded map or diagram.",
    "Work directly from the original image. Do not imagine a redrawn or regenerated version of it.",
    "Before placing any geometry, infer what real place, anatomy subject, or diagram subject the image is intended to show.",
    "Use that inferred subject as context for the whole task.",
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
}: {
  payload: RawParserPayload;
  preference: GeometryPreference;
  model: string | null;
  buffer: Buffer;
}): Promise<ParsedDraftPayload> {
  const rawTerritories = (payload.territories ?? []).filter(
    (territory) => territory.label?.trim(),
  );

  if (rawTerritories.length === 0) {
    return {
      diagramKind: "unknown",
      recommendedInteraction: preference === "regions" ? "hybrid" : "points",
      summary:
        "The parser could not confidently extract draft territories from this image.",
      warnings: [
        ...(model
          ? ["The model returned no usable regions, so a point-first draft is safer."]
          : []),
      ],
      territories: fallbackTerritories(preference),
    };
  }

  const raster = await loadRasterImage(buffer);
  const normalizedTargets = rawTerritories.map((territory, index) => ({
    label: territory.label?.trim() || `Region ${index + 1}`,
    labelBox: normalizeBox(territory.labelBox),
    geometryModeHint:
      territory.geometryModeHint ??
      (preference === "points" ? "point" : "hybrid"),
    rawConfidence: territory.confidence ?? 0.55,
    rawNotes: territory.notes?.filter(Boolean) ?? [],
  }));
  const derivedTargets = await deriveGeometryFromImage({
    image: raster,
    buffer,
    targets: normalizedTargets.map((target) => ({
      label: target.label,
      labelBox: target.labelBox,
      geometryModeHint: target.geometryModeHint,
    })),
    geometryPreference: preference,
    diagramKind: payload.diagramKind ?? "unknown",
  });
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

  if (fallbackCount > 0) {
    warnings.push(
      `${fallbackCount} target${fallbackCount === 1 ? "" : "s"} fell back to label-based anchors because region segmentation was not confident enough.`,
    );
  }

  return {
    diagramKind: payload.diagramKind ?? "unknown",
    recommendedInteraction:
      payload.recommendedInteraction ??
      (territories.some((territory) => territory.polygons.length > 0)
        ? "hybrid"
        : "points"),
    summary:
      payload.summary?.trim() ||
      "Created a draft spatial layer from the uploaded image.",
    warnings,
    territories,
  };
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
      verbosity: "low",
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
  buffer,
  dataUrl,
  title,
  geometryPreference,
}: {
  buffer: Buffer;
  dataUrl: string;
  title: string;
  geometryPreference: GeometryPreference;
}): Promise<{
  payload: ParsedDraftPayload;
  provider: "openai" | "fallback";
  model: string | null;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  const geometryStrategy = getGeometryStrategy();
  const defaultModel = geometryStrategy === "model" ? "gpt-4o" : "gpt-5-mini";
  const model = process.env.OPENAI_MAP_MODEL ?? defaultModel;

  if (!apiKey) {
    return {
      payload: {
        diagramKind: "unknown",
        recommendedInteraction:
          geometryPreference === "regions" ? "hybrid" : "points",
        summary:
          "Saved the upload, but OpenAI parsing is not configured in this environment yet.",
        warnings: [
          "Set OPENAI_API_KEY to generate real territory drafts from uploads.",
        ],
        territories: fallbackTerritories(geometryPreference),
      },
      provider: "fallback",
      model: null,
    };
  }

  const client = new OpenAI({ apiKey });
  const rawPayload =
    geometryStrategy === "segmentation"
      ? await parseRawPayloadWithSegmentation({
          client,
          model,
          dataUrl,
          title,
          geometryPreference,
        })
      : await parseRawPayloadWithModelGeometry({
          client,
          model,
          dataUrl,
          title,
          geometryPreference,
        });

  return {
    payload:
      geometryStrategy === "segmentation"
        ? await normalizeSegmentedPayload({
            payload: rawPayload,
            preference: geometryPreference,
            model,
            buffer,
          })
        : normalizeModelGeometryPayload(rawPayload, geometryPreference, model),
    provider: "openai",
    model,
  };
}
