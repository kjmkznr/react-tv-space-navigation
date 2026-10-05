import { Grid3X3, Home, LayoutDashboard, LayoutGrid, Repeat, Timer } from 'lucide-react-native';

export const iconsCatalog = {
  Home: Home,
  Grid3X3: Grid3X3,
  LayoutGrid: LayoutGrid,
  LayoutDashboard: LayoutDashboard,
  Timer: Timer,
  Repeat: Repeat,
};

export type IconName = keyof typeof iconsCatalog;
