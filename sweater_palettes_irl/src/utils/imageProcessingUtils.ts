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
    let colDiff = diff.diff(pal[i], col);
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
  let pal1MinDists = []
  let pal2MinDists = []

  // Get minimum distance for each color in both palettes
  for (let i = 0; i < numCol; i++) {
    let pal1Col = pal1[i]
    let minDist1 = getMinDist(pal1Col, pal2)
    pal1MinDists.push(minDist1);

    let pal2Col = pal1[2]
    let minDist2 = getMinDist(pal2Col, pal1);
    pal2MinDists.push(minDist2);
  }
  let distSumPal1 = pal1MinDists.reduce((a, b) => {
    return a + b;
  });

  let distSumPal2 = pal2MinDists.reduce((a, b) => {
    return a + b;
  });

  // Calculate MIDCP
  let distAvgPal1 = distSumPal1 / numCol;
  let distAvgPal2 = distSumPal2 / numCol;
  let grandAvg = (distAvgPal1 + distAvgPal2) / 2;
  return grandAvg;
}

