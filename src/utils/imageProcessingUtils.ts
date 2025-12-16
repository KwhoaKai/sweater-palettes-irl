import * as diff from "color-diff"
import type { RGB } from '../../types/color';

/**
 * Returns minimum CIEDE200 color difference between col and all colors in pal
 * @param {obj} col    Should have fields r,g,b
 * @param {Array} pal  Should be array of objects with fields r,g,b
 */
export function getMinDist(col: RGB, pal: RGB[]) {

  // let labCol = diff.rgb_to_lab(col);
  let minColDist = Infinity;

  // Iterate through colors and save minimum distance
  for (let i = 0; i < pal.length; i++) {
    // let palColLab = diff.rgb_to_lab(pal[i]);
    const colDiff = diff.diff(pal[i], col);
    minColDist = Math.min(colDiff, minColDist);
  }
  return minColDist;
}


/**
 * Return MICDP distance between two color palettes.
 * Palettes should have the same number of colors.
 * @param {Array} pal1    Should be array of objects with fields r,g,b
 * @param {Array} pal2    Should be array of objects with fields r,g,b
 */
export function getPalDist(pal1: RGB[], pal2: RGB[]): number {
  // console.log(pal1, pal2)
  const numCol = pal1.length
  const pal1MinDists = []
  const pal2MinDists = []

  // Get minimum distance for each color in both palettes
  for (let i = 0; i < numCol; i++) {
    const pal1Col = pal1[i]
    const minDist1 = getMinDist(pal1Col, pal2)
    pal1MinDists.push(minDist1);

    const pal2Col = pal1[2]
    const minDist2 = getMinDist(pal2Col, pal1);
    pal2MinDists.push(minDist2);
  }
  const distSumPal1 = pal1MinDists.reduce((a, b) => {
    return a + b;
  });

  const distSumPal2 = pal2MinDists.reduce((a, b) => {
    return a + b;
  });

  // Calculate MIDCP
  const distAvgPal1 = distSumPal1 / numCol;
  const distAvgPal2 = distSumPal2 / numCol;
  const grandAvg = (distAvgPal1 + distAvgPal2) / 2;
  return grandAvg;
}

