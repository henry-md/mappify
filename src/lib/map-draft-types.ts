export type GeometryPreference = "auto" | "points" | "regions";
export type DiagramKind = "map" | "medical" | "diagram" | "unknown";
export type InteractionMode = "points" | "regions" | "hybrid";
export type TerritoryGeometryMode = "point" | "polygon" | "hybrid";
export type GeometryStrategy =
  | "outline-generation"
  | "seeded"
  | "segmentation"
  | "model";

export type NormalizedPoint = {
  x: number;
  y: number;
};

export type NormalizedBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type PolygonRegion = {
  outer: NormalizedPoint[];
  holes: NormalizedPoint[][];
};

export type AnchorDerivationMethod =
  | "model-vision"
  | "model-helper-centroid"
  | "model-seed-point"
  | "segmented-region-center"
  | "support-mask-center"
  | "label-box-center"
  | "canvas-center";

export type TerritoryDraft = {
  id: string;
  label: string;
  geometryMode: TerritoryGeometryMode;
  anchor: NormalizedPoint;
  polygons: PolygonRegion[];
  supportPolygons: PolygonRegion[];
  labelBox: NormalizedBox | null;
  seedPoint: NormalizedPoint | null;
  supportSeedPoints: NormalizedPoint[];
  anchorDerivation: AnchorDerivationMethod;
  debugRegionMatchScore?: number | null;
  confidence: number;
  notes: string[];
};

export type ImageAsset = {
  src: string;
  width: number;
  height: number;
  originalFilename: string;
  mimeType: string;
};

export type DraftDebugArtifacts = {
  outlineHelperImage: ImageAsset | null;
  outlineHelperPrompt: string | null;
  outlineHelperModel: string | null;
  outlineGridImage: ImageAsset | null;
  gridLocalizationPrompt: string | null;
  gridLocalizationModel: string | null;
};

export type ParsingMetadata = {
  provider: "openai" | "fallback";
  model: string | null;
  geometryStrategy: GeometryStrategy;
  diagramKind: DiagramKind;
  recommendedInteraction: InteractionMode;
  geometryPreference: GeometryPreference;
  inferredSubject: string | null;
  summary: string;
  warnings: string[];
};

export type MapDraft = {
  id: string;
  title: string;
  createdAt: string;
  status: "parsed" | "needs_attention";
  image: ImageAsset;
  parsing: ParsingMetadata;
  territories: TerritoryDraft[];
  debug?: DraftDebugArtifacts;
};

export type ParsedDraftPayload = {
  diagramKind: DiagramKind;
  recommendedInteraction: InteractionMode;
  inferredSubject: string | null;
  summary: string;
  warnings: string[];
  territories: TerritoryDraft[];
};
