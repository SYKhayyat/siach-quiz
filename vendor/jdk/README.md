# `tools.jar` — the in-browser Java compiler

The Java coding questions are checked by compiling and running the answer in the
browser with [CheerpJ](https://cheerpj.com/) (a WebAssembly JVM). CheerpJ ships a
Java SE runtime, but **not** the JDK's compiler — `javac` lives in `tools.jar`,
which has to be served from this site.

The site loads it as `/vendor/jdk/tools.jar` (see `js/engines/cheerpj-worker.js`).

## What is committed here

`tools.jar` **is committed to this repository**, so the deployed site can compile
Java out of the box. It is 18 MB, which is the price of a working Java question
on a static host. It came from a **Temurin 8** JDK (`OpenJDK`, GPLv2 with the
Classpath Exception — redistributable, and the same licence as the JDK itself).

To replace it with your own:

```
cp "$JAVA_HOME/lib/tools.jar" vendor/jdk/tools.jar    # JAVA_HOME must be a JDK 8
```

If you would rather not ship it, delete it and the Java runner will report:

> The Java runner needs vendor/jdk/tools.jar (see README) — it is not on this server yet.

and the question is left unanswered rather than marked wrong. `git rm` the file
and add `vendor/jdk/*.jar` back to `.gitignore` in that case.

CheerpJ itself is free for personal use and technical evaluation — check the
licence if this is used commercially.
