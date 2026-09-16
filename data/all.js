import python from "./python.js";
import java from "./java.js";
import rust from "./rust.js";
import pl from "./pl.js";
import algo from "./algo.js";
import ds from "./ds.js";
import os from "./os.js";
import arch from "./arch.js";
import net from "./net.js";
import sql from "./sql.js";
import concurrency from "./concurrency.js";
import meth from "./meth.js";

/**
 * Every topic lives in `data/<id>.js`. The insertion order below is the display
 * order on the home screen, grouped four at a time by each topic's `group`
 * field — so every row of the grid is full.
 */
export const topics = {
  python,
  java,
  rust,
  pl,
  algo,
  ds,
  os,
  arch,
  net,
  sql,
  concurrency,
  meth,
};

/** One line of context per section, keyed by the topic's `group`. */
const GROUP_BLURBS = {
  Languages: "Syntax, paradigms and typing — the languages themselves.",
  Foundations: "The theory and the hardware underneath everything else.",
  "Systems & practice": "How machines talk, store data, share work — and how teams ship it.",
};

/** The home screen's sections, in order, taken from the topics themselves. */
export function topicGroups() {
  const groups = [];
  for (const [id, topic] of Object.entries(topics)) {
    const title = topic.group || "Topics";
    let bucket = groups.find((g) => g.title === title);
    if (!bucket) {
      bucket = { title, blurb: GROUP_BLURBS[title] || "", ids: [] };
      groups.push(bucket);
    }
    bucket.ids.push(id);
  }
  return groups;
}

/** Headline numbers for the home screen (counted, never hard-coded). */
export function totals() {
  const list = Object.values(topics);
  let written = 0;
  let multipleChoice = 0;
  let code = 0;
  for (const topic of list) {
    written += (topic.text || []).length;
    multipleChoice += (topic.questions || []).length;
    code += (topic.text || []).filter((q) => q.kind === "code").length;
  }
  return { topics: list.length, written, multipleChoice, code, questions: written + multipleChoice };
}
