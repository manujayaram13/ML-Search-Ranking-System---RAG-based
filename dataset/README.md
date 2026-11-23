# Multimodal Search: Learning-to-Rank (Stage 2 XGBoost) Dataset

This dataset is specifically constructed for training an **XGBoost / LambdaMART Learning-to-Rank model** to rerank Stage 1 candidate segments across documents, marksheets, images, and video keyframes.

## 📊 Summary Statistics
- **Total Queries**: `245`
- **Total Candidate Rows**: `5145`
- **Train Set**: `196 queries` (`4116 rows`)
- **Validation Set**: `49 queries` (`1029 rows`)
- **Ranking Objective**: `rank:ndcg` / `rank:pairwise`

## 🏷️ Ground-Truth Relevance Labels
- **3 (Exact Target)**: Exact segment answering the query (e.g. `marks_and_scores` segment for a marks/qualification question).
- **2 (Highly Relevant)**: Relevant summary, keyframe, caption, or chunk from the target file.
- **1 (Partially Related)**: Background segment or general text with moderate similarity.
- **0 (Irrelevant / Negative)**: Distractor or unrelated file.

## 📁 Files in this Dataset:
1. `ranking_train.csv`: Training partition (grouped by `qid`).
2. `ranking_val.csv`: Validation partition for early stopping.
3. `ranking_full.csv`: Complete dataset.
4. `ranking_metadata.json`: Feature types, distributions, and schema definitions.
