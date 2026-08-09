---
name: OMR answer-key compatibility
description: Durable format and grading rules for multi-set OMR answer keys with multiple accepted choices.
---

Each question's accepted answers are represented as a list of option labels, such as `["A", "C"]`. A six-set key stores one such answer-list array for each detected set. Legacy keys that stored one string per question must be normalized to one-item lists when read.

**Why:** The sheet can contain six shuffled answer patterns, and some questions accept more than one correct choice. Treating either case as a single string causes incorrect grading or grades a sheet against the wrong set.

**How to apply:** Detect the set before grading, select that set's answer lists, and award credit when the detected student option is included in the question's accepted list. Keep export and result displays readable by joining multiple accepted answers with “or”.