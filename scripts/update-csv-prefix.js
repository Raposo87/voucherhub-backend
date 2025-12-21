// scripts/update-csv-prefix.js
import fs from 'fs';
import path from 'path';

function getArg(flag, def = undefined) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

function run() {
  const csvFile = getArg('--file');
  const oldPrefix = getArg('--old', 'BANC');
  const newPrefix = getArg('--new');

  if (!csvFile) {
    console.error('❌ Use: node update-csv-prefix.js --file=arquivo.csv --old=BANC --new=NOVOPREFIXO');
    console.error('');
    console.error('   Exemplo: node update-csv-prefix.js --file=sponsor-vouchers-BANC-1763900611440.csv --old=BANC --new=BANK');
    process.exit(1);
  }

  if (!newPrefix) {
    console.error('❌ Você precisa especificar o novo prefixo com --new=NOVOPREFIXO');
    process.exit(1);
  }

  const filepath = path.isAbsolute(csvFile) ? csvFile : path.join(process.cwd(), csvFile);

  if (!fs.existsSync(filepath)) {
    console.error(`❌ Arquivo não encontrado: ${filepath}`);
    process.exit(1);
  }

  console.log(`📄 Lendo arquivo: ${filepath}`);
  console.log(`🔄 Substituindo prefixo "${oldPrefix}-" por "${newPrefix}-"`);

  let fileContent = fs.readFileSync(filepath, 'utf-8');
  const lines = fileContent.split('\n');
  
  let replacedCount = 0;
  const updatedLines = lines.map((line, index) => {
    // Pula o cabeçalho (primeira linha)
    if (index === 0) {
      return line;
    }
    
    // Substitui o prefixo nos códigos
    if (line.includes(`${oldPrefix}-`)) {
      replacedCount++;
      return line.replace(new RegExp(`${oldPrefix}-`, 'g'), `${newPrefix}-`);
    }
    
    return line;
  });

  // Salva o arquivo atualizado (sobrescreve o original)
  const updatedContent = updatedLines.join('\n');
  fs.writeFileSync(filepath, updatedContent, 'utf-8');

  console.log(`✅ Concluído! ${replacedCount} códigos foram atualizados.`);
  console.log(`📝 Arquivo atualizado: ${filepath}`);
  console.log('');
  console.log('💡 Próximo passo: Execute o script de importação:');
  console.log(`   node scripts/import-sponsor-vouchers.js --file=${csvFile}`);
}

run();


