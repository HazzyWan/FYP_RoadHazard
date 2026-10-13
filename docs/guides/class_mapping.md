Canonical taxonomy mapping

This project uses a simplified 3-class production taxonomy for reporting and evaluation in the thesis:

- `pothole`
- `crack`  (aggregates all crack subtypes)
- `other`  (background / all remaining classes)

Mapping from dataset labels (example from `datasets/road_hazards_combined/data_multiclass.yaml`):

- `pothole` -> `pothole`
- `alligator_crack` -> `crack`
- `longitudinal_crack` -> `crack`
- `transverse_crack` -> `crack`  # not used as a separate published class
- `other` -> `other`

Notes:
- The web application and admin UI expose the 3 production labels above for clarity and operational consistency. Crack subtypes are kept in dataset annotations for training nuance, but they are collapsed to `crack` for evaluation and reporting in Chapters 4–5.
- There is no `debris` class in the deployed taxonomy (previous confusion-artifacts that listed `debris` should be corrected to `other`).

Usage:
- Use `scripts/aggregate_confusion.py` to convert an existing confusion matrix (CSV or NPY) produced by evaluation into the 3x3 aggregated confusion matrix used in the report.
