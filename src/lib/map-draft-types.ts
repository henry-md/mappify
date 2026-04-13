export type GeometryPreference = "auto" | "points" | "regions";
export type DiagramKind = "map" | "medical" | "diagram" | "unknown";
export type InteractionMode = "points" | "regions" | "hybrid";
export type TerritoryGeometryMode = "point" | "polygon" | "hybrid";

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

export type ParsingMetadata = {
  provider: "openai" | "fallback";
  model: string | null;
  diagramKind: DiagramKind;
  recommendedInteraction: InteractionMode;
  geometryPreference: GeometryPreference;
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
};

export type ParsedDraftPayload = {
  diagramKind: DiagramKind;
  recommendedInteraction: InteractionMode;
  summary: string;
  warnings: string[];
  territories: TerritoryDraft[];
};
