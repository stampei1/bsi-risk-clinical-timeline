# BSI Timeline — clinician view

A clinician-oriented timeline of stool-microbiome bloodstream-infection (BSI) risk for allogeneic HCT patients.
Step through a patient's stay one stool sample at a time; later data stay hidden.

- **Risk tiers** (per organism): High = at or above the cut-off that catches 50% of pre-infection stool samples;
  Watch = between that and the 90% cut-off; Low = below. Each tier's observed rate of BSI within 14 days is shown.
  The cut-offs can be changed in Settings (⚙).
- **Timeline**: E. coli and Enterococcus risk, their abundance in stool, antibiotics (by drug and route),
  neutrophils (ANC) and temperature.

**Data.** Real, de-identified, retrospective allo-HCT patients from MSK (Xavier Lab), listed under the dataset's
de-identified PatientIDs. Scores are out-of-fold predictions of the 14-day E. coli and Enterococcus models; tier
cut-offs are chosen on the same cohort and have not been validated prospectively. Not for clinical use.

Research version: https://stampei1.github.io/bsi-risk-simulator/ · Unit view: https://stampei1.github.io/bsi-risk-tool-clinical-workflow/
