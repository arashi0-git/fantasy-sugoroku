// CPU の一言。CPU が何をなぜしたのかを、性格に合った口調の短いセリフにする。
// s は行動する前の状態。手札の中身や秘密の使命のように、本人しか知らないことは言わない
// （使命が進む土地では「前から欲しかった」とだけ匂わせる）。

import { BOARD, GROUPS } from '../data/board';
import { CONFIG, LEVEL, LEVEL_NAMES } from '../data/config';
import {
  Action,
  actorOf,
  buyoutPrice,
  completedGroups,
  GameState,
  GROUP_SQUARES,
  isLand,
  isTourist,
  rankByAssets,
  touristCount,
  TOURIST_SQUARES,
  TRIPLE_GROUPS,
} from '../core/game';
import { missionGain } from './cpu';
import { Personality } from './personality';

type Lines = { bold: string; careful: string; schemer: string };
const say = (pers: Personality, l: Lines) => l[pers.id];
const fmt = (n: number) => `${n.toLocaleString('ja-JP')}G`;

/** 独占勝利まであと1つの相手か */
function isReach(s: GameState, id: number): boolean {
  return completedGroups(s, id).length >= TRIPLE_GROUPS - 1 || touristCount(s, id) >= TOURIST_SQUARES.length - 1;
}

/** sq を me が手に入れると、その色グループが全部 me のものになるか */
function completesGroup(s: GameState, me: number, sq: number): boolean {
  const g = BOARD[sq].group;
  return !!g && isLand(sq) && GROUP_SQUARES[g].every((x) => x === sq || s.properties[x]?.owner === me);
}

/** 空き地 sq の残りの土地が、すべて同じ相手のものか（買えば相手の独占を阻める） */
function blocksGroup(s: GameState, me: number, sq: number): boolean {
  const g = BOARD[sq].group;
  if (!g || !isLand(sq)) return false;
  const others = GROUP_SQUARES[g].filter((x) => x !== sq);
  if (!others.every((x) => s.properties[x])) return false;
  const owners = new Set(others.map((x) => s.properties[x].owner));
  return owners.size === 1 && !owners.has(me);
}

export function cpuLine(s: GameState, pers: Personality, a: Action): string | null {
  const meId = actorOf(s);
  const p = s.players[meId];
  const name = (sq: number) => BOARD[sq].name;
  const who = (id: number) => s.players[id].name;

  switch (a.type) {
    case 'useCard': {
      switch (a.card) {
        case 'seal': {
          const t = who(a.target!);
          if (isReach(s, a.target!)) {
            return say(pers, {
              bold: `${t}、独占なんてさせるか！ 霧の孤島へ行ってこい！`,
              careful: `${t}さんの独占は止めます。霧の孤島で休んでいてください`,
              schemer: `${t}の独占は阻む。霧の孤島へ送らせてもらう`,
            });
          }
          return say(pers, {
            bold: `首位の${t}、ちょっと足止めだ！`,
            careful: `${t}さん、少しだけ足を止めてもらいますね`,
            schemer: `${t}には、しばらく退場してもらう`,
          });
        }
        case 'raid': {
          const sq = a.square!;
          const o = s.properties[sq].owner;
          if (s.touristClaim === o && isTourist(sq)) {
            return say(pers, {
              bold: `${who(o)}の観光地、令状で奪ってやる！`,
              careful: `${who(o)}さん、観光地の独占はここで止めます`,
              schemer: `守り切りはさせない。令状で${name(sq)}をもらう`,
            });
          }
          if (completesGroup(s, meId, sq)) {
            const g = GROUPS[BOARD[sq].group!].name;
            return say(pers, {
              bold: `令状だ！ ${name(sq)}をいただいて${g}をそろえる！`,
              careful: `略奪の令状で${name(sq)}を。これで${g}がそろいます`,
              schemer: `令状を使う。${name(sq)}で${g}が揃う`,
            });
          }
          if (isReach(s, o)) {
            return say(pers, {
              bold: `${who(o)}の独占なんてさせるか！ 令状で奪う！`,
              careful: `${who(o)}さんの独占は、令状で崩させてもらいます`,
              schemer: `${who(o)}の独占は令状で崩す`,
            });
          }
          return say(pers, {
            bold: `${who(o)}の${name(sq)}、令状でいただき！`,
            careful: `略奪の令状で、${who(o)}さんの${name(sq)}をいただきます`,
            schemer: `${who(o)}の${name(sq)}には用がある。令状で奪う`,
          });
        }
        case 'earthquake': {
          const sq = a.square!;
          const o = s.properties[sq].owner;
          const leader = rankByAssets(s)[0] === o;
          const why = isReach(s, o) ? '独占は許さない。' : leader ? '首位の土地だ。' : '';
          return say(pers, {
            bold: `${why}${who(o)}の${name(sq)}、揺らしてやる！`,
            careful: `${why}${who(o)}さんの${name(sq)}、少し崩させてもらいます`,
            schemer: `${why}${who(o)}の${name(sq)}は崩しておく`,
          });
        }
        case 'destiny': {
          const dest = (p.position + a.sum!) % BOARD.length;
          const free = (isLand(dest) || isTourist(dest)) && !s.properties[dest];
          if (free) {
            return say(pers, {
              bold: `${fmt(CONFIG.destinyCost)}払ってでも${name(dest)}が欲しい！`,
              careful: `運命の賽で${name(dest)}を狙います`,
              schemer: `${name(dest)}は押さえておきたい。運命の賽を使う`,
            });
          }
          return say(pers, {
            bold: `危ない道はごめんだ！ 行き先は${name(dest)}！`,
            careful: `危ないマスは避けたいので、${name(dest)}へ`,
            schemer: `この先は危うい。運命の賽で${name(dest)}へ`,
          });
        }
        case 'festival':
          return say(pers, {
            bold: `${name(a.square!)}で祭りだ！ 通行料は倍だぞ！`,
            careful: `${name(a.square!)}でお祭りを開きます`,
            schemer: `${name(a.square!)}で祭りを開く。通るなら覚悟しろ`,
          });
        case 'growth': {
          const lv = LEVEL_NAMES[s.properties[a.square!].level + 1];
          return say(pers, {
            bold: `${name(a.square!)}を${lv}に！ どんどん建てるぞ！`,
            careful: `${name(a.square!)}を${lv}にしておきます`,
            schemer: `${name(a.square!)}を${lv}に。布石は打った`,
          });
        }
        case 'treasure':
          return say(pers, { bold: '宝箱、開けちゃうぞ！', careful: '宝箱を開けてみますね', schemer: '宝箱を開ける。中身次第だ' });
        case 'steal': {
          const t = who(a.target!);
          return say(pers, {
            bold: `${t}、手札を1枚もらっていくぜ！`,
            careful: `${t}さん、カードを1枚いただきますね`,
            schemer: `${t}の手札、1枚拝借する`,
          });
        }
        case 'swap': {
          const o = s.properties[a.square!].owner;
          return say(pers, {
            bold: `契約書だ！ ${who(o)}の${name(a.square!)}と交換だ！`,
            careful: `交換の契約書で、${name(a.square!)}をいただきます`,
            schemer: `契約書を使わせてもらう。${name(a.square!)}は私がもらう`,
          });
        }
        case 'sanctuary':
          return say(pers, {
            bold: `${name(a.square!)}は聖域だ。手出しはさせない！`,
            careful: `${name(a.square!)}は紋章で守っておきます`,
            schemer: `${name(a.square!)}には聖域の紋章を。奪えはしない`,
          });
        case 'curse': {
          const o = s.properties[a.square!].owner;
          return say(pers, {
            bold: `${who(o)}の${name(a.square!)}、しばらく稼げないようにしてやる！`,
            careful: `${name(a.square!)}には刻印を。しばらく通行料は入りません`,
            schemer: `${name(a.square!)}に呪いの刻印。稼ぎ頭は封じておく`,
          });
        }
        case 'relocate':
          return say(pers, {
            bold: `${name(a.give!)}の建物を${name(a.square!)}へ移築だ！`,
            careful: `建物を${name(a.square!)}へ移しておきます`,
            schemer: `移築の書。建物の置き場所を整える`,
          });
        default:
          return null;
      }
    }

    case 'reroll': {
      if (!a.use) return null;
      return say(pers, {
        bold: 'その目はなしだ！ 時間を巻き戻す！',
        careful: 'その出目は都合が悪いので、巻き戻します',
        schemer: '巻き戻しだ。その未来は選ばない',
      });
    }

    case 'adjust': {
      if (a.delta === 0 || s.phase.kind !== 'adjust') return null;
      const dest = (p.position + s.phase.sum + a.delta) % BOARD.length;
      return say(pers, {
        bold: `追い風に乗って${name(dest)}へ！`,
        careful: `追い風の羽で${name(dest)}へずらします`,
        schemer: `羽で一歩調整する。${name(dest)}へ`,
      });
    }

    case 'buy': {
      if (s.phase.kind !== 'buy') return null;
      const sq = s.phase.square;
      if (completesGroup(s, meId, sq)) {
        const g = GROUPS[BOARD[sq].group!].name;
        return say(pers, { bold: `これで${g}は全部オレのものだ！`, careful: `${g}がそろいました`, schemer: `${g}を揃えた。計算どおりだ` });
      }
      if (blocksGroup(s, meId, sq)) {
        const g = GROUPS[BOARD[sq].group!].name;
        return say(pers, {
          bold: `${g}はそろえさせないぞ！`,
          careful: `${g}をそろえられると困るので、買っておきます`,
          schemer: `${g}の独占は阻ませてもらう`,
        });
      }
      if (missionGain(s, meId, sq) > 0) {
        return say(pers, { bold: 'ここは前から欲しかったんだ！', careful: 'この土地、ちょうど探していたんです', schemer: 'この土地には意味がある' });
      }
      if (isTourist(sq) && touristCount(s, meId) + 1 >= TOURIST_SQUARES.length - 1) {
        const n = touristCount(s, meId) + 1;
        return say(pers, { bold: `観光地、${n}つ目だ！`, careful: `観光地はこれで${n}つです`, schemer: `観光地は${n}つ。あと少しだ` });
      }
      if (a.level >= LEVEL.HOTEL) {
        return say(pers, {
          bold: `${name(sq)}にいきなり${LEVEL_NAMES[a.level]}だ！`,
          careful: `${name(sq)}に${LEVEL_NAMES[a.level]}まで建てます`,
          schemer: `${name(sq)}に${LEVEL_NAMES[a.level]}まで建てる`,
        });
      }
      return null;
    }

    case 'build': {
      if (s.phase.kind !== 'build' || a.level < LEVEL.HOTEL) return null;
      const sq = s.phase.square;
      if (a.level === LEVEL.LANDMARK) {
        return say(pers, {
          bold: `${name(sq)}にランドマークだ！ もう誰にも奪えないぞ！`,
          careful: `${name(sq)}をランドマークにしました。これで買収されません`,
          schemer: `${name(sq)}にランドマーク。もう奪えまい`,
        });
      }
      return say(pers, {
        bold: `${name(sq)}を${LEVEL_NAMES[a.level]}に！ 稼がせてもらうぞ`,
        careful: `${name(sq)}を${LEVEL_NAMES[a.level]}に建て替えます`,
        schemer: `${name(sq)}を${LEVEL_NAMES[a.level]}に。ここが稼ぎどころだ`,
      });
    }

    case 'buyout': {
      if (s.phase.kind !== 'buyout') return null;
      const sq = s.phase.square;
      const o = s.properties[sq].owner;
      if (s.touristClaim === o && isTourist(sq)) {
        return say(pers, {
          bold: '観光地の独り占めはさせないぞ！',
          careful: '観光地の独占は、ここで止めさせてもらいます',
          schemer: '守り切りはさせない。買収する',
        });
      }
      if (completesGroup(s, meId, sq)) {
        const g = GROUPS[BOARD[sq].group!].name;
        return say(pers, {
          bold: `${name(sq)}、いただき！ これで${g}がそろう！`,
          careful: `${name(sq)}を買い取ります。これで${g}がそろいます`,
          schemer: `${name(sq)}をもらう。これで${g}が揃う`,
        });
      }
      if (isReach(s, o)) {
        return say(pers, {
          bold: `${who(o)}の独占なんてさせるか！`,
          careful: `${who(o)}さんの独占は崩させてもらいます`,
          schemer: `${who(o)}の独占は崩す`,
        });
      }
      if (missionGain(s, meId, sq) > 0 || (p.mission === 'raider' && !p.missionDone)) {
        return say(pers, {
          bold: `${who(o)}、その土地はオレがもらう！`,
          careful: `${who(o)}さん、その土地はどうしても欲しいんです`,
          schemer: 'その土地には用がある。もらっていく',
        });
      }
      const price = fmt(buyoutPrice(s, sq));
      return say(pers, {
        bold: `${name(sq)}、${price}でいただき！`,
        careful: `${name(sq)}を${price}で買い取らせてください`,
        schemer: `${name(sq)}は${price}で買収する`,
      });
    }

    case 'fly':
      return say(pers, {
        bold: `天翔で${name(a.square)}までひとっ飛びだ！`,
        careful: `天翔で${name(a.square)}へ飛びます`,
        schemer: `天翔で${name(a.square)}へ。空から行かせてもらう`,
      });

    case 'payEscape':
      return say(pers, { bold: '霧の中で待ってられるか！', careful: '脱出料を払って霧を抜けます', schemer: '時間が惜しい。脱出料で抜ける' });

    case 'react': {
      if (!a.use || s.phase.kind !== 'react') return null;
      const { card, ctx } = s.phase;
      if (card === 'angel') {
        return say(pers, { bold: '天使の加護！ 払わないぞ！', careful: '天使の加護で、今回はお支払いなしです', schemer: '天使の加護。払う必要はない' });
      }
      if (card === 'barrier' && ctx.type === 'buyout') {
        return say(pers, {
          bold: `結界だ！ ${name(ctx.square)}は渡さない！`,
          careful: `守護の結界で${name(ctx.square)}を守ります`,
          schemer: `結界を張る。${name(ctx.square)}は渡さない`,
        });
      }
      return say(pers, { bold: '鏡の盾！ そっくり返してやる！', careful: '鏡の盾で、お返しします', schemer: '鏡の盾。そのまま返す' });
    }

    case 'choose': {
      const sq = a.square;
      if (s.phase.kind === 'festival') {
        return say(pers, {
          bold: `${name(sq)}で祭りだ！ 通行料は倍だぞ！`,
          careful: `${name(sq)}でお祭りを開きます`,
          schemer: `${name(sq)}で祭りを開く`,
        });
      }
      if (s.phase.kind === 'blessing') {
        return say(pers, { bold: `祝福で${name(sq)}をパワーアップ！`, careful: `祝福で${name(sq)}を建て増します`, schemer: `祝福は${name(sq)}に使う` });
      }
      if (s.phase.kind === 'travel') {
        return say(pers, { bold: `転移先は${name(sq)}だ！`, careful: `${name(sq)}へ転移します`, schemer: `転移先は${name(sq)}` });
      }
      return null;
    }

    case 'puppet': {
      if (a.delta === 0 || s.phase.kind !== 'puppet') return null;
      const roller = s.players[s.current];
      const dest = (roller.position + s.phase.sum + a.delta) % BOARD.length;
      return say(pers, {
        bold: `${roller.name}、行き先は${name(dest)}だ！`,
        careful: `${roller.name}さん、${name(dest)}へどうぞ`,
        schemer: `糸を引く。${roller.name}の行き先は${name(dest)}だ`,
      });
    }

    case 'push': {
      const t = s.players[a.target];
      const dest = (t.position + a.dir + BOARD.length) % BOARD.length;
      return say(pers, {
        bold: `どけっ！ ${t.name}は${name(dest)}へ行ってこい！`,
        careful: `${t.name}さん、少し${name(dest)}へ寄ってくださいね`,
        schemer: `${t.name}には${name(dest)}へ移ってもらう`,
      });
    }

    case 'gamble':
      if (!a.use) return null;
      return say(pers, { bold: '勝負だ！ 半額にしてやる！', careful: '一か八か、勝負します', schemer: '勝負だ。分はこちらにある' });

    case 'sell':
      return say(pers, {
        bold: `くっ、${name(a.square)}を手放すしかない…`,
        careful: `${name(a.square)}を手放します…`,
        schemer: `${name(a.square)}は手放す。やむを得ない`,
      });

    case 'offerTrade': {
      const t = who(a.to);
      return say(pers, {
        bold: `${t}、${name(a.want)}を譲ってくれ！ 話が早いだろ？`,
        careful: `${t}さん、${name(a.want)}の取引をお願いできませんか`,
        schemer: `${t}、${name(a.want)}が欲しい。取引しよう`,
      });
    }

    case 'answerTrade': {
      if (s.phase.kind !== 'trade') return null;
      const t = who(s.phase.offer.from);
      if (a.accept) {
        return say(pers, {
          bold: `いいだろう、${t}の取引に乗った！`,
          careful: `その条件なら、${t}さんと取引します`,
          schemer: `悪くない条件だ。${t}と取引する`,
        });
      }
      return say(pers, {
        bold: `${t}、その条件じゃ話にならないね`,
        careful: `ごめんなさい、${t}さん。その条件では受けられません`,
        schemer: `${t}、条件が合わない。断らせてもらう`,
      });
    }

    default:
      return null;
  }
}
