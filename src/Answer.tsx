import React from "react";
import App from "./App";

// App.tsxのロジックをAnswer用に使う。roleを"answerer"で固定
export default function Answer(props: any) {
  return <App forcedRole="answerer" {...props} />;
}
