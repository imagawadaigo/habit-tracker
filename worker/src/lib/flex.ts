import type { Habit, HabitRecord, UserProfile } from '../types';
import { xpToNextLevel } from './xp';

/**
 * 習慣一覧のFlex Message contentsを構築する。
 * postback.ts と message.ts の両方から呼べる共通関数。
 */
export function buildHabitListFlex(
  habits: Habit[],
  todayRecords: HabitRecord[],
  weekRecords: HabitRecord[],
  today: string,
  profile?: UserProfile | null
): Record<string, unknown> {
  const todayMap = new Map(todayRecords.map(r => [r.habit_id, r.status]));

  // 直近7日の日付リスト
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    days.push(d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }));
  }
  const dayLabels = days.map(d => {
    const date = new Date(d + 'T00:00:00+09:00');
    return ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  });

  // レベル・XPバー
  const level = profile?.level ?? 1;
  const totalXp = profile?.total_xp ?? 0;
  const { current, needed, progress } = xpToNextLevel(totalXp);
  const barWidthPercent = Math.max(3, Math.round(progress * 100));

  const levelBox = {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: `Lv.${level}`, size: 'md', weight: 'bold', color: '#FF8A65' },
          { type: 'text', text: `${totalXp} XP`, size: 'xs', color: '#8D6E63', align: 'end', gravity: 'center' },
        ],
      },
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [{ type: 'filler' }],
            backgroundColor: '#FF8A65',
            flex: barWidthPercent,
            height: '6px',
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [{ type: 'filler' }],
            backgroundColor: '#FFE0B2',
            flex: 100 - barWidthPercent,
            height: '6px',
          },
        ],
        cornerRadius: '3px',
        height: '6px',
      },
      {
        type: 'text',
        text: `次のレベルまで ${needed - current} XP`,
        size: 'xxs',
        color: '#AAAAAA',
        align: 'end',
      },
    ],
    spacing: 'xs',
    paddingBottom: '12px',
  };

  const dayHeader = {
    type: 'box',
    layout: 'horizontal',
    contents: dayLabels.map(label => ({
      type: 'text', text: label, size: 'xxs', color: '#AAAAAA', align: 'center', flex: 1,
    })),
    paddingBottom: '4px',
  };

  const habitRows = habits.map((h, i) => {
    const num = i + 1;
    const todayStatus = todayMap.get(h.id);
    const isDone = todayStatus === 'achieved' || todayStatus === 'minimum';

    const habitCreated = h.created_at ? h.created_at.split('T')[0] : days[0];
    const weekDots = days.map(d => {
      // 登録前の日は空欄
      if (d < habitCreated) return { type: 'text', text: ' ', size: 'xs', color: '#FFFFFF', align: 'center', flex: 1 };
      const rec = weekRecords.find(r => r.habit_id === h.id && r.date === d);
      if (!rec) return { type: 'text', text: '-', size: 'xs', color: '#DDDDDD', align: 'center', flex: 1 };
      if (rec.status === 'achieved') return { type: 'text', text: 'O', size: 'xs', color: '#4CAF50', align: 'center', flex: 1, weight: 'bold' };
      if (rec.status === 'minimum') return { type: 'text', text: '/', size: 'xs', color: '#FF9800', align: 'center', flex: 1 };
      return { type: 'text', text: 'x', size: 'xs', color: '#F44336', align: 'center', flex: 1 };
    });

    const weekTotal = weekRecords.filter(r => r.habit_id === h.id && (r.status === 'achieved' || r.status === 'minimum')).length;

    // 登録日からの有効日数を計算（週間表示の範囲内）
    const eligibleDays = days.filter(d => d >= habitCreated).length;
    const rate = eligibleDays > 0 ? Math.round((weekTotal / eligibleDays) * 100) : 0;

    const contents: unknown[] = [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: `${num}. ${h.name}`, size: 'sm', weight: 'bold', color: '#4E342E', flex: 4 },
          ...(h.current_streak > 0
            ? [{ type: 'text', text: `${h.current_streak}d`, size: 'xs', color: '#FF8A65', align: 'end', flex: 1 }]
            : [{ type: 'filler' }]),
        ],
      },
    ];

    if (h.achievement_line || h.minimum_line) {
      contents.push({
        type: 'text',
        text: [h.achievement_line ? `達成: ${h.achievement_line}` : '', h.minimum_line ? `最低: ${h.minimum_line}` : ''].filter(Boolean).join(' / '),
        size: 'xxs',
        color: '#8D6E63',
        wrap: true,
      });
    }

    contents.push(
      { type: 'box', layout: 'horizontal', contents: weekDots, paddingTop: '2px' },
      { type: 'text', text: `今週 ${weekTotal}/${eligibleDays}日 (${rate}%)`, size: 'xxs', color: '#8D6E63', align: 'end' }
    );

    // 記録ボタン（未記録の場合のみ表示）
    if (!isDone) {
      contents.push({
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'button',
            action: {
              type: 'postback',
              label: '達成',
              data: `action=quick_record&index=${num}&status=achieved`,
              displayText: `${num}`,
            },
            style: 'primary',
            height: 'sm',
            color: '#4CAF50',
            flex: 1,
          },
          { type: 'filler', flex: 0 },
          {
            type: 'button',
            action: {
              type: 'postback',
              label: '最低ライン',
              data: `action=quick_record&index=${num}&status=minimum`,
              displayText: `${num}m`,
            },
            style: 'secondary',
            height: 'sm',
            flex: 1,
          },
        ],
        spacing: 'sm',
        paddingTop: '4px',
      });
    } else {
      contents.push({
        type: 'text',
        text: todayStatus === 'achieved' ? '-- 達成済み --' : '-- 最低ライン達成 --',
        size: 'xxs',
        color: todayStatus === 'achieved' ? '#4CAF50' : '#FF9800',
        align: 'center',
        paddingTop: '4px',
      });
    }

    return {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents,
      paddingBottom: '8px',
    };
  });

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: '習慣一覧', size: 'lg', weight: 'bold', color: '#4E342E' },
        { type: 'text', text: today, size: 'xs', color: '#8D6E63', align: 'end', gravity: 'center' },
      ],
      paddingAll: 'lg',
      backgroundColor: '#FFF8F0',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [levelBox, dayHeader, ...habitRows],
      paddingAll: 'lg',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: 'O=達成 /=最低ライン -=未記録', size: 'xxs', color: '#AAAAAA', align: 'center' },
      ],
      paddingAll: 'sm',
      backgroundColor: '#FFF3E0',
    },
  };
}
