export interface PoseTemplate {
  id: string;
  name: string;
  category: string;
  imageUrl: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export const POSE_TEMPLATES: PoseTemplate[] = [
  {
    id: 'urban-stoop',
    name: 'Urban Stoop',
    category: 'Street',
    imageUrl: '/poses/urban-stoop.jpg',
    difficulty: 'easy',
  },
  {
    id: 'step-recline',
    name: 'Step Recline',
    category: 'Relaxed',
    imageUrl: '/poses/step-recline.jpg',
    difficulty: 'easy',
  },
  {
    id: 'pole-lean',
    name: 'Pole Lean',
    category: 'Street',
    imageUrl: '/poses/pole-lean.jpg',
    difficulty: 'medium',
  },
  {
    id: 'cafe-sip',
    name: 'Cafe Sip',
    category: 'Casual',
    imageUrl: '/poses/cafe-sip.jpg',
    difficulty: 'easy',
  },
  {
    id: 'riverside-sit',
    name: 'Riverside Sit',
    category: 'Moody',
    imageUrl: '/poses/riverside-sit.jpg',
    difficulty: 'medium',
  },
  {
    id: 'park-bench-chill',
    name: 'Park Bench Chill',
    category: 'Relaxed',
    imageUrl: '/poses/park-bench-chill.jpg',
    difficulty: 'medium',
  },
  {
    id: 'curb-summer',
    name: 'Curb Summer',
    category: 'Fun',
    imageUrl: '/poses/curb-summer.jpg',
    difficulty: 'hard',
  },
  {
    id: 'curb-look-up',
    name: 'Curb Look Up',
    category: 'Street',
    imageUrl: '/poses/curb-look-up.jpg',
    difficulty: 'easy',
  },
  {
    id: 'stair-stride',
    name: 'Stair Stride',
    category: 'Street Style',
    imageUrl: '/poses/stair-stride.jpg',
    difficulty: 'medium',
  },
  {
    id: 'squat-sip',
    name: 'Squat & Sip',
    category: 'Casual',
    imageUrl: '/poses/squat-sip.jpg',
    difficulty: 'easy',
  },
  {
    id: 'sunlit-strut',
    name: 'Sunlit Strut',
    category: 'Daylight',
    imageUrl: '/poses/sunlit-strut.jpg',
    difficulty: 'easy',
  },
  {
    id: 'night-toast',
    name: 'Night Toast',
    category: 'Night Out',
    imageUrl: '/poses/night-toast.jpg',
    difficulty: 'medium',
  },
];

export function getPoseById(id: string): PoseTemplate | undefined {
  return POSE_TEMPLATES.find((p) => p.id === id);
}
