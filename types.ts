
export enum ItemType {
  LOST = 'LOST',
  FOUND = 'FOUND',
}

export interface Item {
  id: string;
  name: string;
  description: string;
  category: string;
  location: string;
  date: string; // Should be ISO string or similar
  itemType: ItemType;
  contact?: string;
  imageUrl?: string; // For future image upload feature
}

export enum TabKey {
  REPORT_LOST = 'REPORT_LOST',
  REPORT_FOUND = 'REPORT_FOUND',
  VIEW_LOST = 'VIEW_LOST',
  VIEW_FOUND = 'VIEW_FOUND',
}
