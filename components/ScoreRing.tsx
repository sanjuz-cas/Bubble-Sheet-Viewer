import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Colors from '@/constants/colors';

const C = Colors.light;

interface ScoreRingProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
}

export function ScoreRing({ percentage, size = 120, strokeWidth = 10, color, label }: ScoreRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference - (percentage / 100) * circumference;
  const ringColor = color || (percentage >= 70 ? C.success : percentage >= 50 ? C.warning : C.error);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={C.cardBorder}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={progress}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.textContainer}>
        <Text style={[styles.percentage, { fontSize: size * 0.22 }]}>
          {Math.round(percentage)}%
        </Text>
        {label ? <Text style={[styles.label, { fontSize: size * 0.1 }]}>{label}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    position: 'absolute',
    alignItems: 'center',
  },
  percentage: {
    fontFamily: 'Nunito_800ExtraBold',
    color: C.text,
  },
  label: {
    fontFamily: 'Nunito_500Medium',
    color: C.textSecondary,
    marginTop: 2,
  },
});
