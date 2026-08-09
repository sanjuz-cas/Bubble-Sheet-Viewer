export interface AnswerKey {
  id: string;
  name: string;
  subject: string;
  totalQuestions: number;
  optionsPerQuestion: number;
  /** Accepted option labels for each question, e.g. [["A", "C"], ["B"]]. */
  answers: string[][];
  setAnswers?: Record<string, string[][]>;
  createdAt: string;
}

export interface ScanResult {
  id: string;
  answerKeyId: string;
  answerKeyName: string;
  subject: string;
  detectedAnswers: string[][];
  correctAnswers: string[][];
  score: number;
  totalQuestions: number;
  percentage: number;
  questionResults: QuestionResult[];
  scannedAt: string;
  imageUri?: string;
  detectedSet?: string;
  detectedRollNumber?: string;
}

export interface QuestionResult {
  questionNumber: number;
  selected: string[];
  correct: string[];
  isCorrect: boolean;
}

export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';

export function getGrade(percentage: number): Grade {
  if (percentage >= 95) return 'A+';
  if (percentage >= 85) return 'A';
  if (percentage >= 80) return 'B+';
  if (percentage >= 70) return 'B';
  if (percentage >= 65) return 'C+';
  if (percentage >= 55) return 'C';
  if (percentage >= 45) return 'D';
  return 'F';
}

export function getGradeColor(grade: Grade): string {
  switch (grade) {
    case 'A+': return '#7BC67E';
    case 'A': return '#A8E6CF';
    case 'B+': return '#B5D8F7';
    case 'B': return '#DCD6F7';
    case 'C+': return '#FFD166';
    case 'C': return '#FFDAB9';
    case 'D': return '#FFB7B2';
    case 'F': return '#FF6B6B';
  }
}
