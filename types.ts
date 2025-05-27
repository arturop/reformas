
export interface TaxonomyNode {
  id: string;
  label: string;
  parent: string | null;
  level: number;
  children: TaxonomyNode[];
  // Optional: Add keywords or synonyms if needed for more advanced matching logic later
  // keywords?: string[]; 
}

export interface ClassifiedJobInfo {
  job_id: string;
  job_label: string;
  level: number;
  confidence_score: number;
  raw_user_text: string;
}
