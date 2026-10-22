// 秘密の使命。ゲーム開始時に1人1枚ずつ配られ、本人にしか見えない。達成すると報酬がもらえ、全員に公開される。
// goal は達成に必要な数、reward は報酬（G）。進み具合の数え方は core/game.ts の missionProgress。

export type MissionId =
  | 'frontier'
  | 'landmark'
  | 'hotels'
  | 'tourist2'
  | 'lands8'
  | 'chain3'
  | 'rich'
  | 'raider'
  | 'toll'
  | 'noble';

export interface Mission {
  id: MissionId;
  name: string;
  text: string;
  goal: number;
  reward: number;
}

export const MISSIONS: Record<MissionId, Mission> = {
  frontier: { id: 'frontier', name: '四方の領主', text: '盤面の4辺すべてに、建物の建った土地を持つ', goal: 4, reward: 1000 },
  landmark: { id: 'landmark', name: '天を衝く塔', text: 'ランドマークを2つ建てる', goal: 2, reward: 1000 },
  hotels: { id: 'hotels', name: '宿場の主', text: 'ホテル以上の建物を4つ持つ', goal: 4, reward: 1000 },
  tourist2: { id: 'tourist2', name: '名所めぐり', text: '観光地を2つ持つ', goal: 2, reward: 1000 },
  lands8: { id: 'lands8', name: '大地主', text: '土地と観光地を合わせて8つ持つ', goal: 8, reward: 1000 },
  chain3: { id: 'chain3', name: '城壁の連なり', text: '2マス以上続いた自分の土地を、合わせて3つ持つ', goal: 3, reward: 1000 },
  rich: { id: 'rich', name: '黄金の蔵', text: '所持金を5,000G以上にする', goal: 5000, reward: 1000 },
  raider: { id: 'raider', name: '征服者', text: '買収を4回成功させる', goal: 4, reward: 1000 },
  toll: { id: 'toll', name: '関所の長', text: '通行料を合計3,000G受け取る', goal: 3000, reward: 1000 },
  noble: { id: 'noble', name: '王都の貴族', text: '魔導と王都の土地を合わせて2つ持つ', goal: 2, reward: 1000 },
};

export const MISSION_LIST: Mission[] = Object.values(MISSIONS);
