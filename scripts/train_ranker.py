"""
Advanced XGBoost Learning-to-Rank (LTR) Training Pipeline v2.5
Objective: rank:ndcg (LambdaMART) with deep feature interactions & regularization
Metric: ndcg@10, ndcg@5, ndcg@3, ndcg@1
"""

import os
import json
import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import ndcg_score

print("=" * 70)
print("  Advanced XGBoost Stage 2 Learning-to-Rank (LTR) Training Pipeline v2.5")
print("=" * 70)

# Paths
DATASET_DIR = os.path.join(os.path.dirname(__file__), "..", "dataset")
MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "model")
os.makedirs(MODEL_DIR, exist_ok=True)

train_path = os.path.join(DATASET_DIR, "ranking_train.csv")
val_path = os.path.join(DATASET_DIR, "ranking_val.csv")

# 1. Load Data
print("\n[1/5] Loading datasets...")
df_train = pd.read_csv(train_path)
df_val = pd.read_csv(val_path)

print(f"  - Train records: {len(df_train)} across {df_train['qid'].nunique()} queries")
print(f"  - Val records:   {len(df_val)} across {df_val['qid'].nunique()} queries")

# 2. Feature Engineering & Preprocessing
NUMERIC_FEATURES = [
    "cosine_similarity",
    "lexical_overlap",
    "exact_name_match",
    "bm25_score",
    "char_ngram_similarity",
    "semantic_lexical_interaction",
    "semantic_exact_interaction",
    "importance_weighted_similarity",
    "intent_alignment",
    "rank_discount_signal",
    "importance_score",
    "is_question",
    "question_marks_affinity",
    "has_timestamp",
    "query_word_count",
    "content_word_count",
    "length_ratio",
    "log_content_words"
]

CATEGORICAL_FEATURES = ["file_type", "segment_type", "query_type", "category"]

print("\n[2/5] Encoding features and one-hot vectors...")
df_combined = pd.concat([df_train, df_val], axis=0)
df_encoded = pd.get_dummies(df_combined, columns=CATEGORICAL_FEATURES, drop_first=False)

feature_cols = NUMERIC_FEATURES + [c for c in df_encoded.columns if c not in df_combined.columns and c not in ["qid", "query", "file_name", "segment_id", "relevance_label", "stage1_rank"]]
print(f"  - Total Feature Count: {len(feature_cols)}")
for idx, col in enumerate(feature_cols, 1):
    print(f"    {idx:2d}. {col}")

# Split back to Train / Val
df_train_enc = df_encoded.iloc[:len(df_train)].copy()
df_val_enc = df_encoded.iloc[len(df_train):].copy()

# Sort by qid to preserve grouping
df_train_enc.sort_values(by=["qid"], inplace=True)
df_val_enc.sort_values(by=["qid"], inplace=True)

# Group sizes (number of candidate rows per query)
train_groups = df_train_enc.groupby("qid", sort=False).size().to_numpy()
val_groups = df_val_enc.groupby("qid", sort=False).size().to_numpy()

X_train = df_train_enc[feature_cols].values
y_train = df_train_enc["relevance_label"].values

X_val = df_val_enc[feature_cols].values
y_val = df_val_enc["relevance_label"].values

# 3. Model Architecture & Advanced Hyperparameters
print("\n[3/5] Initializing Advanced XGBoost Ranker (LambdaMART)...")
ranker = xgb.XGBRanker(
    objective="rank:ndcg",
    eval_metric="ndcg@10",
    n_estimators=350,
    learning_rate=0.035,
    max_depth=5,              # Deep enough to capture complex feature crosses
    min_child_weight=3,       # Robust leaf regularization
    subsample=0.85,           # Bagging for variance reduction
    colsample_bytree=0.85,    # Feature fraction per tree
    colsample_bylevel=0.85,   # Feature fraction per depth level
    gamma=0.08,               # Minimum loss reduction for split
    reg_lambda=2.0,           # L2 regularization against overfitting
    reg_alpha=0.2,            # L1 sparsity regularization
    random_state=42,
    tree_method="hist"
)

# 4. Training with Early Stopping
print("\n[4/5] Training model with validation monitoring...")
ranker.fit(
    X_train, y_train,
    group=train_groups,
    eval_set=[(X_train, y_train), (X_val, y_val)],
    eval_group=[train_groups, val_groups],
    verbose=50
)

# 5. Evaluation Metrics
print("\n[5/5] Evaluating Advanced Ranking Quality...")
val_preds = ranker.predict(X_val)
df_val_enc["pred_score"] = val_preds

# Compute NDCG@1, NDCG@3, NDCG@5, NDCG@10 across validation queries
ndcg_1_list, ndcg_3_list, ndcg_5_list, ndcg_10_list = [], [], [], []

for qid, group in df_val_enc.groupby("qid"):
    true_rel = np.asarray([group["relevance_label"].values])
    pred_rel = np.asarray([group["pred_score"].values])
    
    if len(true_rel[0]) > 1:
        ndcg_1_list.append(ndcg_score(true_rel, pred_rel, k=1))
        ndcg_3_list.append(ndcg_score(true_rel, pred_rel, k=3))
        ndcg_5_list.append(ndcg_score(true_rel, pred_rel, k=5))
        ndcg_10_list.append(ndcg_score(true_rel, pred_rel, k=10))

print("\n" + "=" * 50)
print(f"  [ADVANCED VALIDATION RANKING METRICS]")
print(f"  * NDCG@1:  {np.mean(ndcg_1_list):.4f}")
print(f"  * NDCG@3:  {np.mean(ndcg_3_list):.4f}")
print(f"  * NDCG@5:  {np.mean(ndcg_5_list):.4f}")
print(f"  * NDCG@10: {np.mean(ndcg_10_list):.4f}")
print("=" * 50)

# Feature Importance Breakdown
print("\n[Feature Importance - Top Signals by Gain]:")
importances = ranker.feature_importances_
sorted_idx = np.argsort(importances)[::-1]
for i in sorted_idx[:15]:
    print(f"  - {feature_cols[i]}: {importances[i]:.4f}")

# Save Model in JSON format
model_json_path = os.path.join(MODEL_DIR, "xgboost_ranker.json")
ranker.save_model(model_json_path)
print(f"\n[OK] Advanced model successfully exported to: {model_json_path}")

# Save Feature Schema for Node.js / TypeScript Inference
feature_schema = {
    "version": "2.5.0-advanced",
    "feature_columns": feature_cols,
    "numeric_features": NUMERIC_FEATURES,
    "categorical_features": CATEGORICAL_FEATURES,
    "metrics": {
        "ndcg@1": float(np.mean(ndcg_1_list)),
        "ndcg@3": float(np.mean(ndcg_3_list)),
        "ndcg@5": float(np.mean(ndcg_5_list)),
        "ndcg@10": float(np.mean(ndcg_10_list))
    }
}

schema_path = os.path.join(MODEL_DIR, "feature_schema.json")
with open(schema_path, "w", encoding="utf-8") as f:
    json.dump(feature_schema, f, indent=2)

print(f"[OK] Advanced feature schema exported to: {schema_path}")
