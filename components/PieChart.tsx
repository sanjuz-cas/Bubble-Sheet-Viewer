import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import Colors from '@/constants/colors';

const C = Colors.light;

interface PieChartProps {
  data: { label: string; value: number; color: string }[];
  size?: number;
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function createArcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

export function PieChart({ data, size = 140 }: PieChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return (
      <View style={[styles.container, { width: size }]}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={size / 2 - 4} fill={C.cardBorder} />
        </Svg>
        <Text style={styles.emptyText}>No data</Text>
      </View>
    );
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  let currentAngle = 0;

  return (
    <View style={styles.wrapper}>
      <Svg width={size} height={size}>
        {data.map((item, i) => {
          if (item.value === 0) return null;
          const angle = (item.value / total) * 360;
          const path = createArcPath(cx, cy, r, currentAngle, currentAngle + angle);
          currentAngle += angle;
          return <Path key={i} d={path} fill={item.color} />;
        })}
        <Circle cx={cx} cy={cy} r={r * 0.5} fill={C.white} />
      </Svg>
      <View style={styles.legend}>
        {data.filter(d => d.value > 0).map((item, i) => (
          <View key={i} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: item.color }]} />
            <Text style={styles.legendLabel}>{item.label}</Text>
            <Text style={styles.legendValue}>{item.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  emptyText: {
    position: 'absolute',
    fontFamily: 'Nunito_500Medium',
    fontSize: 13,
    color: C.textSecondary,
  },
  legend: {
    flex: 1,
    gap: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 12,
    color: C.text,
    flex: 1,
  },
  legendValue: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: C.text,
  },
});
