## Upload And Parsing V1

### Goal

Turn a user-uploaded map or diagram into a draft quiz layer quickly:

- every item must have an anchor point
- items may optionally also have closed polygon geometry
- geography should prefer regions when the image supports them
- medical / pointer-heavy diagrams should gracefully fall back to points only

### Core Product Stance

V1 is not "perfect automatic segmentation for any image".

V1 is:

- upload an image
- generate a smart draft
- keep the spatial model editable later

The model should help us get to a usable draft fast, but it should not be the final geometric source of truth forever.

### Spatial Model

Each quiz item stores:

- `label`
- `anchor`
- `geometryMode`: `point | polygon | hybrid`
- zero or more polygon regions

Anchors are always present.
Polygons are optional.

This gives us:

- point-only diagrams for anatomy and messy educational graphics
- polygon-based maps for click-anywhere territory quizzes
- hybrid projects where some items have shapes and some only have dots

### Geometry Rules

- All coordinates are normalized to the original image.
- Polygon rings must always be closed.
- Overlap should be avoided whenever possible.
- Tiny landlocked or nested territories should eventually be represented with holes or multipolygons, not broad overlap.
- If the system is not confident in a polygon, it should fall back to a point instead of inventing fake geometry.

### Parsing Pipeline

#### 1. Upload

Store the original PNG or JPEG and record its width and height.

#### 2. Image Understanding

Use OpenAI vision to infer:

- diagram type: map, anatomy, generic diagram, unknown
- whether region geometry seems trustworthy
- candidate labels
- label boxes for the rendered text
- recommended interaction mode: points, regions, or hybrid

Important: OpenAI is currently the default source for first-draft anchors and polygons.
That geometry is still considered editable draft data rather than permanent ground truth.

#### 3. Draft Geometry

The current default path is model-first geometry:

- ask OpenAI vision for labels, label boxes, anchors, and optional draft polygons directly from the original image
- keep all coordinates normalized to the source image so the overlay stays aligned
- treat returned polygons as editable draft geometry, not immutable source of truth

There is also an experimental segmentation path retained behind an environment toggle:

- use model/OCR label boxes to build a text mask
- repaint or mask label glyphs so segmentation sees the underlying territory fill
- segment candidate regions across the full image instead of growing one region per label
- trace polygons from those segmented regions
- compute the anchor from the interior of the matched region mask
- assign labels onto the segmented regions after the regions already exist

This makes both polygon recovery and anchor placement structural consequences of the geometry pipeline rather than model guesses.

Longer term, the "real outlines" should come from image geometry:

- OCR / text masking
- contour detection
- morphological closing
- connected-component extraction
- contour tracing and simplification

That CV layer should refine or replace the initial draft polygons later without changing the stored product shape model.

#### 4. Post-processing

After parsing:

- clamp all points into `[0, 1]`
- close every polygon ring
- drop invalid or tiny polygons
- downgrade uncertain polygon items to point-only items
- record how each anchor was derived so quality can be inspected later

### Why This Model Works

It handles both cases we care about:

- maps with real territories
- medical diagrams where regions are implied or not worth tracing

That lets the UI stay consistent while the parser gets smarter over time.

### Implementation Notes For This Stage

- Store draft uploads on the filesystem for now.
- Store parsed draft metadata as JSON files.
- Keep the OpenAI prompt conservative about precision: return usable draft anchors and simplified polygons, not pixel-perfect traces.
- Render both image and SVG overlay in the same coordinate space.
- Always show anchor points, even when polygons exist.

### Future Upgrades

- Add OCR + text box masking before geometry extraction
- Add a stronger CV refinement pass for true outline recovery
- Support holes and multipolygons explicitly in the editor
- Add manual editing tools for vertices, edges, and anchor points
- Persist drafts in Postgres once the schema settles
