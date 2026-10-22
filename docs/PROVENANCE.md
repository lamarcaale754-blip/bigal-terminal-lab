# Source provenance

This edition uses the newer React terminal at local revision `3f08e1a` (April 20, 2026). It is separate from the older single-file BigAl Sniper dashboard. The top menu, dense layout, chart stack, candidates, positions, settings, journal, keyboard shortcuts and styling come from that newer implementation.

The strategy extraction retains source candidate filters, position accounting, entry/exit paths, manual/adaptive/hybrid parameters, dynamic hold, passive volume-exit signals, and ordinary Paper/Legacy execution. Local transport, validation, deterministic input generation and testing were added around those paths. The paid gRPC/Rust execution integration remains private and is not advertised as available by this edition's backend.

Chart calculations were corrected inside the original chart presentation: observed prices replace curve-percentage substitutions, fabricated wicks/volume are removed, and PnL uses recorded timestamps and balances. Missing history is identified rather than invented. Openly licensed fonts preserve the original sizes and proportions; proprietary binaries are absent.

This public repository has its own history. No private Git history, archives, wallet files, credentials, actual trade journals, provider logs or unrelated product code are included. Browser demonstration data and offline feed messages are fictional. Offensive orchestration, fabricated-volume tooling and audio were removed from the public source, not merely hidden in the UI.

The complete source repository and the latest local original remain separate. The source revision establishes lineage, not proof of live correctness. The validation described here applies to this public code and its documented tests.
