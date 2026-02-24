import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '@/constants/colors';

const C = Colors.light;

interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  maxValue?: number;
  height?: number;
}

export function BarChart({ data, maxValue, height = 140 }: BarChartProps) {
  const max = maxValue || Math.max(...data.map(d => d.value), 1);
  const barColors = [C.primary, C.secondary, C.accent, C.sky, C.peach, C.coral, C.mint, C.lavender];

  return (
    <View style={styles.container}>
      <View style={[styles.chartArea, { height }]}>
        {data.map((item, i) => {
          const barHeight = (item.value / max) * height * 0.85;
          const barColor = item.color || barColors[i % barColors.length];
          return (
            <View key={i} style={styles.barColumn}>
              <Text style={styles.barValue}>{item.value}</Text>
              <View
                style={[
                  styles.bar,
                  {
                    height: Math.max(barHeight, 4),
                    backgroundColor: barColor,
                  },
                ]}
              />
              <Text style={styles.barLabel} numberOfLines={1}>{item.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 4,
  },
  chartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
  },
  barColumn: {
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 2,
  },
  bar: {
    width: '70%',
    minWidth: 16,
    maxWidth: 40,
    borderRadius: 8,
    marginBottom: 6,
  },
  barValue: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: C.text,
    marginBottom: 4,
  },
  barLabel: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 10,
    color: C.textSecondary,
  },
});
